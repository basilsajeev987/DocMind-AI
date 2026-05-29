from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, Dict, Any

from src.llm.llm_inference import LLMInference
from src.utils.logger import get_logger

logger = get_logger(__name__)


@dataclass
class LLMConfig:
    model_dir: Optional[str] = None
    device: Optional[str] = None
    max_new_tokens: int = 128
    temperature: float = 0.6
    top_p: float = 0.9
    max_gpu_memory_gb: float = 7.0
    quantization: str = "auto"


class LLMPipeline:
    """
    Thin orchestration layer around LLMInference.

    - Owns one LLMInference instance (loaded once)
    - Provides a simple `run()` API for the rest of your app
    """

    def __init__(self, config: Optional[LLMConfig] = None, **overrides: Any):
        """
        You can pass:
          - config=LLMConfig(...)
          - or keyword overrides like model_dir="...", max_new_tokens=256, etc.
        """
        base = config or LLMConfig()
        cfg = {**base.__dict__, **overrides}

        self.cfg = LLMConfig(**cfg)
        logger.info(
            "Initializing LLMPipeline with "
            f"device={self.cfg.device}, quantization={self.cfg.quantization}, "
            f"max_new_tokens={self.cfg.max_new_tokens}"
        )

        self.llm = LLMInference(
            model_dir=self.cfg.model_dir,
            device=self.cfg.device,
            max_new_tokens=self.cfg.max_new_tokens,
            temperature=self.cfg.temperature,
            top_p=self.cfg.top_p,
            max_gpu_memory_gb=self.cfg.max_gpu_memory_gb,
            quantization=self.cfg.quantization,
        )

    def run(self, text: str, emotion: str = "neutral") -> str:
        """
        Main entrypoint: takes user text (+ optional emotion) and returns assistant text.
        """
        try:
            return self.llm.generate_response(text=text, emotion=emotion)
        except Exception as e:
            import traceback
            tb = traceback.format_exc()
            logger.exception(f"LLM generation failed: {e}\n{tb}")
            # TEMP: send the error back so we can fix it
            return f"❌ LLM generation failed: {e}\n\n{tb}"

    def health(self) -> Dict[str, Any]:
        """
        Simple health/metadata info useful for debugging.
        """
        info: Dict[str, Any] = {
            "model_dir": str(self.llm.model_dir),
            "device": self.llm.device,
            "dtype": str(self.llm.model_dtype),
            "quantization": self.llm.quantization,
            "max_new_tokens": self.llm.max_new_tokens,
            "temperature": self.llm.temperature,
            "top_p": self.llm.top_p,
        }
        return info
