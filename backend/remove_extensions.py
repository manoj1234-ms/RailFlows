import os
import re

src_dir = r"c:\Users\admin\Desktop\Railflow\backend\src"

# Match from '...' lines (which are always single-line)
from_pattern = re.compile(r'(from\s+[\'"])(.*?)\.(ts|js)([\'"])')

for root, dirs, files in os.walk(src_dir):
    for file in files:
        if file.endswith('.ts'):
            file_path = os.path.join(root, file)
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()
            
            # Perform replacement
            new_content = from_pattern.sub(r'\1\2\4', content)
            
            if new_content != content:
                with open(file_path, 'w', encoding='utf-8') as f:
                    f.write(new_content)
                print(f"Cleaned import paths in {file_path}")
