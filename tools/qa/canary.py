#!/usr/bin/env python3
"""Run under xvfb-run; never put the generated canary in arguments or logs."""
import json, os, pathlib, subprocess, time, uuid
root = pathlib.Path.cwd()
data = root / '.artifacts/canary'
data.mkdir(parents=True, exist_ok=True)
settings = dict(language='en', skipReview=True, keepMappings=False, autostart=False, welcomed=True,
                scrubShortcut='Ctrl+Alt+S', restoreShortcut='Ctrl+Alt+R', dictionary=[], detectors={})
(data/'settings.json').write_text(json.dumps(settings))
(data/'mappings.json').unlink(missing_ok=True)
env = dict(os.environ, SCRUB_DATA_DIR=str(data), WEBKIT_DISABLE_DMABUF_RENDERER='1')
binary = os.environ.get('SCRUB_BINARY', str(root/'src-tauri/target/debug/scrub-desktop'))
canary = ('private-' + uuid.uuid4().hex + '@example.com').encode()
started = time.time()
def clip(value): subprocess.run(['xclip','-selection','clipboard'], input=value, check=True)
def read(): return subprocess.check_output(['xclip','-selection','clipboard','-o'])
def action(flag): subprocess.run([binary,flag],env=env,check=True); time.sleep(.7)
def scan(allowed=()):
    hits=[]
    paths=set(data.rglob('*'))
    for directory, _, names in os.walk('/tmp'):
        for name in names:
            p=pathlib.Path(directory)/name
            try:
                if p.stat().st_mtime >= started: paths.add(p)
            except (OSError,PermissionError): pass
    for p in paths:
        try:
            if p.is_file() and not p.is_symlink() and p.stat().st_size < 100_000_000 and canary in p.read_bytes() and p not in allowed: hits.append(str(p.relative_to(root)) if p.is_relative_to(root) else '/tmp/[redacted path]')
        except (OSError,PermissionError): pass
    titles=subprocess.run(['xdotool','search','--name','.*'],capture_output=True,text=True).stdout.split()
    for window in titles:
        title=subprocess.run(['xdotool','getwindowname',window],capture_output=True).stdout
        assert canary not in title, 'Canary in window title'
    assert not hits, 'Unexpected canary files: '+repr(hits)
with open(data/'stdout','wb') as out,open(data/'stderr','wb') as err:
    app=subprocess.Popen([binary],env=env,stdout=out,stderr=err)
    try:
        time.sleep(2)
        clip(canary);action('--scrub-clipboard');assert read()==b'[EMAIL_1]'
        clip(b'[EMAIL_1] [EMAIL_1]');action('--restore-clipboard');assert read()==canary+b' '+canary
        scan();assert not (data/'mappings.json').exists()
        # Explicit CLI persistence is read by the running desktop on its next action.
        result=subprocess.run(['node','cli/scrub.js','--keep'],input=canary,env=env,capture_output=True,check=True)
        clip(result.stdout);action('--restore-clipboard');assert read().strip()==canary
        mapping=data/'mappings.json';assert mapping.stat().st_mode&0o777==0o600
        assert canary in mapping.read_bytes();scan((mapping,))
        text=canary+b' next-'+canary
        clip(text);action('--scrub-clipboard')
        restored=subprocess.run(['node','cli/scrub.js','restore','--last'],input=read(),env=env,capture_output=True,check=True)
        assert restored.stdout.strip()==text
        scan((mapping,))
    finally:
        app.terminate();app.wait(timeout=10)
        clip(b'canary-test-complete')
        (data/'mappings.json').unlink(missing_ok=True)
print('Canary privacy and CLI-to-desktop shared-store restore pass; persistent mapping mode is 0600.')
