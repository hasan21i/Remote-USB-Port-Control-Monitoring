import re
import sys

def fix_mojibake(file_path):
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()

    def replacer(match):
        text = match.group(0)
        try:
            # Reconstruct original bytes from cp1252 interpretation, then decode as utf-8
            return text.encode('cp1252').decode('utf-8')
        except:
            return text

    # Use a regex that looks for typical mojibake characters like Ø, â, Ù, etc.
    # We will just apply it to the whole file string for anything inside single or double quotes or backticks
    
    # Or just replace known patterns
    pattern = r"['\"`]\s*[^'`\"]*[ØâÙÏÎ][^'`\"]*\s*['\"`]"
    
    parts = re.split(pattern, content)
    matches = re.findall(pattern, content)
    
    new_content = parts[0]
    for i, match in enumerate(matches):
        fixed = match
        try:
            # extract string contents
            quote_char = match[0]
            inner_text = match[1:-1]
            fixed_inner = inner_text.encode('cp1252').decode('utf-8')
            fixed = quote_char + fixed_inner + quote_char
        except:
            # fallback
            fixed = match
        new_content += fixed + parts[i+1]
        
    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(new_content)
    print("Mojibake fixed!")

fix_mojibake(r'C:\Users\BLU\Desktop\USB-Agent-App\src\App.jsx')
