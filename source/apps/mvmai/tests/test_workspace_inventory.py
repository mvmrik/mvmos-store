"""The trusted discovery helper stays read-only, scoped and administrator-only."""
import ast
import os
import re
import sys
import tempfile
import unittest
from pathlib import Path


class InventoryTests(unittest.TestCase):
    def setUp(self):
        file=Path(__file__).resolve().parents[3]/'backend/apps/mvmai/backend.py'
        node=next(n for n in ast.parse(file.read_text()).body if isinstance(n,ast.FunctionDef) and n.name=='_workspace_inventory')
        ns={'os':os,'re':re,'sys':sys,'_is_apps_hub_admin':lambda token:token=='admin','list_projects':lambda:[]}
        exec(compile(ast.Module(body=[node],type_ignores=[]),str(file),'exec'),ns)
        self.discover=ns['_workspace_inventory']

    def test_admin_gate_file_scope_and_credential_filter(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);(root/'README.md').write_text('Project structure\nAPI_KEY=private-value\nUseful description\n')
            (root/'.env').write_text('SECRET=private-value');(root/'outside').symlink_to('/etc/passwd')
            with self.assertRaises(PermissionError):self.discover('member',folder)
            data=self.discover('admin',folder,'README.md')
            self.assertIn('Useful description',data['text']);self.assertNotIn('private-value',data['text'])
            for name in ('.env','outside','../other'):
                with self.assertRaises(ValueError):self.discover('admin',folder,name)
            self.assertNotIn('.env',[x['name'] for x in self.discover('admin',folder)['entries']])
            self.assertIn('private-value',(root/'README.md').read_text())
