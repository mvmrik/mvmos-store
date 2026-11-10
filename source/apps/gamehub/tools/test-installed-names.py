"""Check a release ZIP using Core's actual installer in a disposable directory.

Usage: python apps/gamehub/tools/test-installed-names.py /path/to/gamehub-1.21.1.zip
"""
import ast, importlib.util, io, json, os, pathlib, random, sqlite3, sys, tempfile, types, zipfile
ROOT = pathlib.Path(__file__).resolve().parents[3]
installer = ast.parse((ROOT / 'backend/plugins.py').read_text())
fn = next(n for n in installer.body if isinstance(n, ast.FunctionDef) and n.name == '_install_from_zip')
package = types.ModuleType('installer_fixture')
package.apphub = types.SimpleNamespace(forget_app_api=lambda app_id: None)
package.public_loader = types.SimpleNamespace(reload_app=lambda app_id: None, install=lambda *args: None)
sys.modules[package.__name__] = package
with tempfile.TemporaryDirectory() as directory:
    root = pathlib.Path(directory)
    backend = root / 'backend'
    backend.mkdir()
    scope = dict(__package__=package.__name__, __file__=str(backend/'plugins.py'),
                 os=os, io=io, json=json, zipfile=zipfile,
                 _app_dir=lambda app_id: str(root/'apps'/app_id),
                 _apply_schema=lambda *args: None,
                 app_backends=types.SimpleNamespace(install=lambda *args: None))
    exec(compile(ast.Module(body=[fn], type_ignores=[]), 'backend/plugins.py', 'exec'), scope)
    archive = pathlib.Path(sys.argv[1])
    result = scope['_install_from_zip'](archive.read_bytes(), 'gamehub', True)
    assert result['manifest']['version'] == '1.21.1'
    assert not result['needs_backend_confirm']
    path = backend/'apps/gamehub/names.py'
    spec = importlib.util.spec_from_file_location('installed_names', path)
    names = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(names)
    assert names.DATA_DIR == root/'apps/gamehub/public/data/names'
    assert not (root/'apps/gamehub/data').exists()
    assert len(names.defaults()) == 10
    assert sum(len(rows) for data in names.defaults().values() for rows in data['groups'].values()) == 3800
    with sqlite3.connect(':memory:') as conn:
        conn.row_factory = sqlite3.Row
        for country in names.defaults():
            rows = names.generate(conn, country=country, count=5, rng=random.Random(7))
            assert len(rows) == 5
            for row in rows:
                assert names.display_name(row, 'en') == row['latin']
    print('PASS: actual Core installer, released ZIP layout, 3,800 defaults, all countries and team names, generation and display.')
