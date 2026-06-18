"""Script to fix circular imports in _routes files."""

import re
from pathlib import Path

routes_dir = Path(__file__).parent / "_routes"

for py_file in routes_dir.glob("*.py"):
    if py_file.name.startswith("_"):
        continue

    content = py_file.read_text(encoding="utf-8")

    # Skip if already fixed
    if "if TYPE_CHECKING:" in content and 'from app_handler import AppHandler' in content:
        # Check if the import is inside TYPE_CHECKING block
        lines = content.split('\n')
        new_lines = []
        in_type_checking = False
        import_fixed = False

        for line in lines:
            if 'if TYPE_CHECKING:' in line:
                in_type_checking = True
                new_lines.append(line)
            elif in_type_checking and 'from app_handler import AppHandler' in line:
                # This import is inside TYPE_CHECKING, keep it
                new_lines.append(line)
                import_fixed = True
            elif in_type_checking and line.strip() and not line.startswith(' ') and not line.startswith('\t'):
                # Exited TYPE_CHECKING block
                in_type_checking = False
                new_lines.append(line)
            else:
                new_lines.append(line)

        if import_fixed:
            # Remove the top-level import if it exists
            new_content = []
            skip_next = False
            for i, line in enumerate(new_lines):
                if skip_next:
                    skip_next = False
                    continue
                if line.strip() == 'from app_handler import AppHandler':
                    # Check if next line is just whitespace (empty line after import)
                    if i + 1 < len(new_lines) and new_lines[i + 1].strip() == '':
                        skip_next = True
                        continue
                    elif i + 1 < len(new_lines) and not new_lines[i + 1].strip():
                        skip_next = True
                        continue
                    else:
                        continue
                new_content.append(line)

            content = '\n'.join(new_content)
            py_file.write_text(content, encoding="utf-8")
            print(f"Fixed: {py_file.name}")
        continue

    # If doesn't have TYPE_CHECKING but has the import, add it
    if "from app_handler import AppHandler" in content:
        # Check if already has typing imports
        has_typing_import = "from typing import" in content

        # Add TYPE_CHECKING to existing import or add new import
        if has_typing_import:
            content = re.sub(
                r'from typing import ([^\n]+)',
                r'from typing import \1, TYPE_CHECKING',
                content
            )
        else:
            # Add import after __future__ import or at top
            if "from __future__ import annotations" in content:
                content = content.replace(
                    "from __future__ import annotations",
                    "from __future__ import annotations\n\nfrom typing import TYPE_CHECKING"
                )
            else:
                content = "from typing import TYPE_CHECKING\n\n" + content

        # Replace top-level import with TYPE_CHECKING block
        content = re.sub(
            r'\nfrom app_handler import AppHandler',
            '',
            content
        )

        # Add TYPE_CHECKING block before router definition or first @router
        router_pos = content.find("@router")
        if router_pos > 0:
            type_checking_block = """if TYPE_CHECKING:
    from app_handler import AppHandler

"""
            content = content[:router_pos] + type_checking_block + content[router_pos:]

        py_file.write_text(content, encoding="utf-8")
        print(f"Fixed: {py_file.name}")

print("Done!")
