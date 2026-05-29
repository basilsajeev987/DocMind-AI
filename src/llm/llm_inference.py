# src/llm/llm_inference.py
from __future__ import annotations

import importlib.util
import os
from pathlib import Path
from typing import Optional, Any

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


def _safe_str(x: Any) -> str:
    """
    HARD guarantee: return a REAL python str (never list/dict/None/numpy/etc)
    """
    import json

    if x is None:
        return ""
    if isinstance(x, str):
        return x

    # handle bytes
    if isinstance(x, (bytes, bytearray)):
        try:
            return x.decode("utf-8", errors="ignore")
        except Exception:
            return str(x)

    # dict/list -> json
    if isinstance(x, (dict, list, tuple)):
        try:
            return json.dumps(x, ensure_ascii=False)
        except Exception:
            return str(x)

    try:
        return str(x)
    except Exception:
        return ""


class LLMInference:
    """
    quantization:
      - "none"
      - "4bit" (bitsandbytes, CUDA only)
      - "auto" (4bit if possible else none)
    """

    def __init__(
        self,
        model_dir: Optional[str] = None,
        device: Optional[str] = None,
        max_new_tokens: int = 128,
        temperature: float = 0.6,
        top_p: float = 0.9,
        max_gpu_memory_gb: float = 7.0,
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

        # ---- Device ----
        req_device = (device or "auto").lower().strip()
        cuda_ok = torch.cuda.is_available()

        if req_device in ("cuda", "gpu"):
            self.device = "cuda" if cuda_ok else "cpu"
        elif req_device == "cpu":
            self.device = "cpu"
        else:
            self.device = "cuda" if cuda_ok else "cpu"

        # ---- Threads ----
        if self.device == "cpu":
            n = max(1, (os.cpu_count() or 8) - 1)
            try:
                torch.set_num_threads(n)
                torch.set_num_interop_threads(1)
            except Exception:
                pass

        # ---- Params ----
        self.max_new_tokens = int(max_new_tokens)
        self.temperature = float(temperature)
        self.top_p = float(top_p)

        # ---- Quantization ----
        q = (quantization or "none").lower().strip()
        if q == "auto":
            q = "4bit" if (self.device == "cuda" and _has_bitsandbytes()) else "none"
        if q in ("int4", "bnb4"):
            q = "4bit"
        if self.device != "cuda":
            q = "none"
        self.quantization = q

        # ---- dtype ----
        self.model_dtype = torch.float16 if self.device == "cuda" else torch.float32

        logger.info(
            f"Loading LLM from {self.model_dir} | device={self.device} "
            f"| quantization={self.quantization} | dtype={self.model_dtype}"
        )

        model_path = str(self.model_dir)

        # ---- Tokenizer ----
        self.tokenizer = AutoTokenizer.from_pretrained(model_path, local_files_only=True)
        if self.tokenizer.pad_token is None:
            self.tokenizer.pad_token = self.tokenizer.eos_token

        # ---- Model kwargs ----
        model_kwargs = {
            "low_cpu_mem_usage": True,
            "use_safetensors": True,
            "local_files_only": True,
        }

        # ---- Load model ----
        if self.device == "cuda" and self.quantization == "4bit":
            if not _has_bitsandbytes():
                raise RuntimeError("4bit requested but bitsandbytes not available.")

            bnb_config = BitsAndBytesConfig(
                load_in_4bit=True,
                bnb_4bit_quant_type="nf4",
                bnb_4bit_use_double_quant=True,
                bnb_4bit_compute_dtype=torch.float16,
            )
            model_kwargs["quantization_config"] = bnb_config
            self.model = AutoModelForCausalLM.from_pretrained(model_path, **model_kwargs)
        else:
            # ✅ FIX: torch_dtype deprecated -> dtype
            model_kwargs["dtype"] = self.model_dtype
            self.model = AutoModelForCausalLM.from_pretrained(model_path, **model_kwargs)
            self.model.to(self.device)

        self.model.eval()
        logger.info("LLM loaded successfully")

    def generate_response(self, text: Any, emotion: str = "neutral") -> str:
        """
        FIXED:
        - Always converts input to a python str
        - Always tokenizes the final string prompt
        - Never passes list/dict into tokenizer by accident
        """
        # 1) Build prompt string
        prompt = _safe_str(text).strip()

        # extra safety: remove weird encodings / surrogate issues
        try:
            prompt = prompt.encode("utf-8", errors="ignore").decode("utf-8", errors="ignore")
        except Exception:
            pass

        if not prompt:
            return ""

        # Debug (safe)
        try:
            logger.info(f"[PROMPT] type={type(prompt)} len={len(prompt)} preview={repr(prompt[:120])}")
        except Exception:
            pass

        # 2) Tokenize FINAL string only
        # ✅ Important: do NOT call tokenizer(text=...) with any non-string variable
        inputs = self.tokenizer(
            prompt,
            return_tensors="pt",
            truncation=True,
            padding=False,
        )
        inputs = {k: v.to(self.device) for k, v in inputs.items()}

        # 3) Generate
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
