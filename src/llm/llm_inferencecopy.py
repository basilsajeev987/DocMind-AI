from __future__ import annotations

import importlib.util
import os
from pathlib import Path
from typing import Optional

os.environ["TRANSFORMERS_NO_TQDM"] = "1"

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

try:
    from transformers import BitsAndBytesConfig
except Exception:
    BitsAndBytesConfig = None

from src.utils.logger import get_logger

logger = get_logger(__name__)


def _has_bitsandbytes() -> bool:
    if BitsAndBytesConfig is None:
        return False
    return importlib.util.find_spec("bitsandbytes") is not None


class LLMInference:
    """
    GPU-first LLM inference for Windows/NVIDIA.

    quantization options:
      - "none"   : normal load (fp16 on cuda, fp32 on cpu)
      - "4bit"   : bitsandbytes 4-bit on cuda (best for 4GB VRAM if available)
      - "auto"   : try 4bit on cuda if bnb available, else none
    """

    def __init__(
        self,
        model_dir: Optional[str] = None,
        device: Optional[str] = None,
        max_new_tokens: int = 128,
        temperature: float = 0.6,
        top_p: float = 0.9,
        max_gpu_memory_gb: float = 7.0,  # kept for compatibility (not required here)
        quantization: str = "auto",
    ):
        # ---- Resolve model dir ----
        if model_dir is None:
            model_dir = (
                Path(__file__).resolve().parent.parent.parent
                / "models"
                / "LLM"
                / "Qwen2.5-Coder-1.5B-Instruct"
            )

        self.model_dir = Path(model_dir).expanduser().resolve()
        if not self.model_dir.exists():
            raise FileNotFoundError(f"Model directory not found: {self.model_dir}")
        if not self.model_dir.is_dir():
            raise NotADirectoryError(f"Model path is not a directory: {self.model_dir}")

        # ---- Decide device ----
        req_device = (device or "auto").lower().strip()
        cuda_ok = torch.cuda.is_available()

        if req_device in ("cuda", "gpu"):
            self.device = "cuda" if cuda_ok else "cpu"
        elif req_device in ("cpu",):
            self.device = "cpu"
        else:
            # auto
            self.device = "cuda" if cuda_ok else "cpu"

        # ---- CPU threads (do NOT cap to 4) ----
        if self.device == "cpu":
            n = max(1, (os.cpu_count() or 8) - 1)
            try:
                torch.set_num_threads(n)
                torch.set_num_interop_threads(1)
            except Exception:
                pass

        # ---- Generation params ----
        self.max_new_tokens = int(max_new_tokens)
        self.temperature = float(temperature)
        self.top_p = float(top_p)

        # ---- Quantization choice ----
        q = (quantization or "none").lower().strip()
        if q == "auto":
            # auto = 4bit on cuda if possible, else none
            q = "4bit" if (self.device == "cuda" and _has_bitsandbytes()) else "none"
        if q in ("int4", "bnb4"):
            q = "4bit"
        self.quantization = q

        if self.device != "cuda":
            # bitsandbytes 4bit is GPU-only; ignore on CPU
            self.quantization = "none"

        # ---- Dtype ----
        # For normal (non-4bit) cuda load: fp16 is fastest + fits 4GB better than fp32
        self.model_dtype = torch.float16 if self.device == "cuda" else torch.float32

        logger.info(
            f"Loading LLM from {self.model_dir} | device={self.device} | "
            f"quantization={self.quantization} | dtype={self.model_dtype}"
        )

        model_path = str(self.model_dir)

        # ---- Tokenizer ----
        self.tokenizer = AutoTokenizer.from_pretrained(model_path, local_files_only=True)
        if self.tokenizer.pad_token is None:
            self.tokenizer.pad_token = self.tokenizer.eos_token

        # ---- Model load kwargs ----
        model_kwargs = {
            "low_cpu_mem_usage": True,
            "use_safetensors": True,
            "local_files_only": True,
        }

        # ---- Load model (4bit or normal) ----
        if self.device == "cuda" and self.quantization == "4bit":
            if not _has_bitsandbytes():
                raise RuntimeError(
                    "quantization=4bit requested but bitsandbytes is not installed/available."
                )

            bnb_config = BitsAndBytesConfig(
                load_in_4bit=True,
                bnb_4bit_quant_type="nf4",
                bnb_4bit_use_double_quant=True,
                bnb_4bit_compute_dtype=torch.float16,
            )
            model_kwargs["quantization_config"] = bnb_config
            # With bnb quant, Transformers handles device placement
            self.model = AutoModelForCausalLM.from_pretrained(model_path, **model_kwargs)
        else:
            model_kwargs["torch_dtype"] = self.model_dtype
            self.model = AutoModelForCausalLM.from_pretrained(model_path, **model_kwargs)
            self.model.to(self.device)

        self.model.eval()
        logger.info("LLM loaded successfully")

    def generate_response(self, text: str, emotion: str = "neutral") -> str:
        import json
        import torch

        # 1) Always build prompt first
        if text is None:
            prompt = ""
        elif isinstance(text, str):
            prompt = text
        else:
            try:
                prompt = json.dumps(text, ensure_ascii=False)
            except Exception:
                prompt = str(text)

        prompt = prompt.strip()

        # ✅ Debug AFTER assignment (so no UnboundLocalError)
        try:
            logger.error(
                f"[PROMPT TYPE]={type(prompt)} len={len(prompt)} preview={repr(prompt[:120])}"
            )
        except Exception:
            pass

        if not prompt:
            return ""

        # 2) Tokenize single string (avoid batch encode issues)
        inputs = self.tokenizer(
            prompt,
            return_tensors="pt",
            padding=False,
            truncation=True,
        )
        inputs = {k: v.to(self.device) for k, v in inputs.items()}

        do_sample = False
        gen_kwargs = dict(
            max_new_tokens=int(self.max_new_tokens),
            do_sample=do_sample,
            pad_token_id=self.tokenizer.eos_token_id,
            eos_token_id=self.tokenizer.eos_token_id,
        )

        if do_sample:
            gen_kwargs["temperature"] = float(self.temperature)
            gen_kwargs["top_p"] = float(self.top_p)

        with torch.inference_mode():
            output_ids = self.model.generate(**inputs, **gen_kwargs)

        generated = output_ids[0][inputs["input_ids"].shape[-1]:]
        return self.tokenizer.decode(generated, skip_special_tokens=True).strip()

