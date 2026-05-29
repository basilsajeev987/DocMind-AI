# Keep package imports lightweight for PyInstaller compatibility.
__all__ = ["LLMInference"]

def __getattr__(name):
    if name == "LLMInference":
        from .llm_inference import LLMInference
        return LLMInference
    raise AttributeError(name)
