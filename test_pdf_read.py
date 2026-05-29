from pypdf import PdfReader

pdf_path = r"C:\Users\Basil Sajeev\Downloads\New folder\- The Go-Giver_ A Little Story About a Powerful Business Idea.pdf"

reader = PdfReader(pdf_path)

print("Pages:", len(reader.pages))
for i, page in enumerate(reader.pages):
    text = page.extract_text()
    print(f"\n--- Page {i+1} ---")
    print(text[:500] if text else "NO TEXT")
