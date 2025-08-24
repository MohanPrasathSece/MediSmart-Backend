import sys
from transformers import AutoModelForCausalLM, AutoTokenizer
from PIL import Image
import pytesseract

# Configure tesseract path if needed
# pytesseract.pytesseract.tesseract_cmd = r'C:\Program Files\Tesseract-OCR\tesseract.exe'

model_path = "../../granite-7b-instruct"

# Load the model and tokenizer
tokenizer = AutoTokenizer.from_pretrained(model_path)
model = AutoModelForCausalLM.from_pretrained(model_path)

def extract_text_from_image(image_path):
    try:
        # Use Tesseract to get raw text from the image
        raw_text = pytesseract.image_to_string(Image.open(image_path))
        return raw_text
    except Exception as e:
        return f"Error processing image with Tesseract: {e}"

def process_text_with_granite(text):
    prompt = f"Extract the medicine names, dosages, and instructions from the following prescription text:\n\n{text}"
    
    input_ids = tokenizer(prompt, return_tensors="pt").input_ids
    
    # Generate text
    outputs = model.generate(input_ids, max_length=500, num_return_sequences=1)
    
    # Decode and return the result
    result = tokenizer.decode(outputs[0], skip_special_tokens=True)
    return result

if __name__ == "__main__":
    if len(sys.argv) > 1:
        image_path = sys.argv[1]
        
        # First, extract text using OCR
        extracted_text = extract_text_from_image(image_path)
        
        if "Error" in extracted_text:
            print(extracted_text)
        else:
            # Then, process the extracted text with Granite
            processed_result = process_text_with_granite(extracted_text)
            print(processed_result)
    else:
        print("Please provide the path to the prescription image.")
