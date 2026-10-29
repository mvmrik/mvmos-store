import ast,hashlib,os,struct,subprocess,tempfile,unittest,zlib,types
from pathlib import Path
ns={'os':os,'subprocess':subprocess}
root=Path(__file__).resolve().parents[3]
for path,name in [(root/'backend/apps/mvmai/backend.py','project_git_status'),(root/'apps/mvmai/api.py','_project_file_diff'),(root/'apps/mvmai/api.py','_project_git_changes')]:
    node=next(n for n in ast.parse(Path(path).read_text()).body if isinstance(n,ast.FunctionDef) and n.name==name);exec(compile(ast.Module(body=[node],type_ignores=[]),path,'exec'),ns)
def object_file(folder,kind,data):
    content=kind.encode()+b' '+str(len(data)).encode()+b'\0'+data;oid=hashlib.sha1(content).hexdigest();p=folder/'.git/objects'/oid[:2]/oid[2:];p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(zlib.compress(content));return bytes.fromhex(oid)
def repository(folder):
    (folder/'.git/refs/heads').mkdir(parents=True);(folder/'.git/objects').mkdir();(folder/'.git/HEAD').write_text('ref: refs/heads/main\n');(folder/'.git/config').write_text('[core]\n repositoryformatversion = 0\n bare = false\n')
    blob=object_file(folder,'blob',b'old\n');tree=object_file(folder,'tree',b'100644 demo.py\0'+blob);commit=object_file(folder,'commit',b'tree '+tree.hex().encode()+b'\nauthor Test <test@example.com> 0 +0000\ncommitter Test <test@example.com> 0 +0000\n\nFixture\n');(folder/'.git/refs/heads/main').write_text(commit.hex()+'\n')
    entry=struct.pack('!10I',0,0,0,0,0,0,0o100644,0,0,4)+blob+struct.pack('!H',7)+b'demo.py\0';entry+=b'\0'*((-len(entry))%8);index=b'DIRC'+struct.pack('!II',2,1)+entry;(folder/'.git/index').write_bytes(index+hashlib.sha1(index).digest());(folder/'demo.py').write_text('new\n')
class DiffTests(unittest.TestCase):
    def test_timestamp_filters_paths_but_keeps_full_git_diff(self):
        repository(self.folder)
        (self.folder/'prior.py').write_text('earlier untracked work\n')
        since = 1700000000.5
        for path in ['demo.py', 'prior.py']:
            os.utime(self.folder/path, (since-60, since-60))
        empty = ns['_project_git_changes'](self.desk, self.project, since)
        self.assertFalse(empty['modified'])
        self.assertFalse(empty['untracked'])
        self.assertEqual(empty['stats'], {})
        (self.folder/'demo.py').write_text('new\nlatest line\n')
        os.utime(self.folder/'demo.py', (since+1, since+1))
        changed = ns['_project_git_changes'](self.desk, self.project, since)
        self.assertEqual(changed['modified'], ['demo.py'])
        self.assertFalse(changed['untracked'])
        # Counts and preview include the earlier change from old -> new too.
        self.assertEqual(changed['stats']['demo.py'], {'added':2,'deleted':1,'binary':False})
        diff = ns['_project_file_diff'](self.desk, self.project, 'demo.py')['diff']
        self.assertIn('-old', diff)
        self.assertIn('+new', diff)
        self.assertIn('+latest line', diff)
        (self.folder/'demo.py').unlink()
        self.assertFalse(ns['_project_git_changes'](self.desk, self.project, since)['deleted'])
    def setUp(self):self.tmp=tempfile.TemporaryDirectory();self.folder=Path(self.tmp.name);self.desk=types.SimpleNamespace(project_git_status=ns['project_git_status']);self.project={'path':str(self.folder)}
    def tearDown(self):self.tmp.cleanup()
    def test_tracked_and_untracked(self):
        repository(self.folder);result=ns['_project_file_diff'](self.desk,self.project,'demo.py');self.assertIn('-old',result['diff']);self.assertIn('+new',result['diff']);self.assertFalse(result['truncated'])
        (self.folder/'[new].js').write_text('const value = 1;\n');new=ns['_project_file_diff'](self.desk,self.project,'[new].js');self.assertIn('+const value = 1;',new['diff'])
    def test_no_git_and_path_escape(self):
        self.assertFalse(ns['_project_file_diff'](self.desk,self.project,'file.py')['is_repo'])
        repository(self.folder)
        for path in ['../outside','/etc/passwd']:
            with self.assertRaises(ValueError):ns['_project_file_diff'](self.desk,self.project,path)
        (self.folder/'link').symlink_to('/etc/passwd')
        with self.assertRaises(ValueError):ns['_project_file_diff'](self.desk,self.project,'link')
    def test_deleted_and_unborn(self):
        repository(self.folder);(self.folder/'demo.py').unlink();self.assertIn('-old',ns['_project_file_diff'](self.desk,self.project,'demo.py')['diff'])
        (self.folder/'.git/refs/heads/main').unlink();self.assertIn('+old',ns['_project_file_diff'](self.desk,self.project,'demo.py')['diff'])
    def test_line_counts(self):
        repository(self.folder)
        (self.folder/'new.py').write_text('line1\nline2')
        (self.folder/'binary.dat').write_bytes(b'a\0b')
        counts=ns['_project_git_changes'](self.desk,self.project)['stats']
        self.assertEqual(counts['demo.py'],{'added':1,'deleted':1,'binary':False})
        self.assertEqual(counts['new.py']['added'],2)
        self.assertTrue(counts['binary.dat']['binary'])
        (self.folder/'demo.py').unlink()
        self.assertEqual(ns['_project_git_changes'](self.desk,self.project)['stats']['demo.py']['deleted'],1)

if __name__ == '__main__':
    unittest.main()
