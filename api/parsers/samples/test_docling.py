import requests
import json

# Your live Cloud Run URL
API_URL = "https://docling-extractor-779297535935.europe-west2.run.app/v1/convert/file"

# Point this to your local bank statement
PDF_PATH = "sample_statement.pdf"

def extract_markdown(pdf_path):
    print(f"Sending {pdf_path} to Docling microservice...")
    
    with open(pdf_path, "rb") as f:
        # Docling expects the file under the 'files' parameter
        response = requests.post(API_URL, files={"files": f})
        
    if response.status_code == 200:
        print("\n--- EXTRACTION SUCCESS ---")
        
        # The response is JSON containing the markdown
        data = response.json()
        
        # FIX: Access the dictionary directly, no [0] index needed
        markdown_text = data['document']['md_content']
        
        print(markdown_text[:1500]) # Print the first 1500 characters
        print("\n...\n[Successfully extracted!]")
    else:
        print(f"Error {response.status_code}: {response.text}")

if __name__ == "__main__":
    extract_markdown(PDF_PATH)