from transformers import AutoTokenizer, AutoModelForCausalLM

model_dir = r"C:\Users\Basil Sajeev\Desktop\per\LADYBIRD\LLM2\models\LLM\Qwen2.5-Coder-1.5B-Instruct"

tokenizer = AutoTokenizer.from_pretrained(model_dir, trust_remote_code=True)
model = AutoModelForCausalLM.from_pretrained(
    model_dir,
    device_map="cpu",
    trust_remote_code=True
)

print("✅ Model loaded successfully")
