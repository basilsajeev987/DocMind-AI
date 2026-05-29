from pathlib import Path
from src.llm.llm_pipeline import LLMPipeline

def main():
    model_path = (Path(__file__).resolve().parent / "models" / "LLM" / "Qwen2.5-Coder-1.5B-Instruct").resolve()

    pipe = LLMPipeline(
        model_dir=str(model_path),
        device="cpu",
        quantization="none",
        max_new_tokens=64,
        temperature=0.7,
        top_p=0.9,
    )

    print("\n✅ Model loaded. Type something (or 'exit' to quit).")

    while True:
        text = input("\nYou: ").strip()
        if text.lower() in {"exit", "quit"}:
            break

        reply = pipe.run(text)
        print("\nLLM:", reply)

if __name__ == "__main__":
    main()
