#!/usr/bin/env python3
import gi, os, subprocess, time, pathlib, json

gi.require_version('Atspi','2.0')
from gi.repository import Atspi
root=pathlib.Path.cwd();data=root/'.artifacts/native-settings';data.mkdir(parents=True,exist_ok=True)
# The official autostart plugin uses the platform home config directory.
settings=dict(language='en',welcomed=True,skipReview=False,keepMappings=False,autostart=False,dictionary=[],detectors={},scrubShortcut='Ctrl+Alt+S',restoreShortcut='Ctrl+Alt+R')
(data/'settings.json').write_text(json.dumps(settings));(data/'mappings.json').unlink(missing_ok=True)
env=dict(os.environ,SCRUB_DATA_DIR=str(data),XDG_CONFIG_HOME=str(data/'config'),WEBKIT_DISABLE_DMABUF_RENDERER='1')
binary=os.environ.get('SCRUB_BINARY','src-tauri/target/debug/scrub-desktop')
def wait(predicate, message, seconds=8):
 end=time.monotonic()+seconds
 while time.monotonic()<end:
  result=predicate()
  if result:return result
  time.sleep(.1)
 raise AssertionError(message)
def children(node):return [node.get_child_at_index(i) for i in range(node.get_child_count())]
def walk(node):
 yield node
 for child in children(node):
  if child:yield from walk(child)
def find_all(name,role=None):return [n for n in walk(accessible) if n.get_name()==name and (role is None or n.get_role_name()==role)]
def find(name,role=None):return wait(lambda:next(iter(find_all(name,role)),None),'Missing accessible control: '+name)
def click(name,role=None,index=0):
 node=find_all(name,role)[index] if index else find(name,role)
 assert node.get_action_iface().do_action(0),'Cannot activate '+name
 time.sleep(.15)
def clip(value):subprocess.run(['xclip','-selection','clipboard'],input=value.encode(),check=True)
def read():return subprocess.check_output(['xclip','-selection','clipboard','-o']).decode()
def key(value):subprocess.run(['xdotool','key',value],check=True);time.sleep(.2)
def action(flag):subprocess.run([binary,flag],env=env,check=True);time.sleep(.3)
def saved():return json.loads((data/'settings.json').read_text())
with open(data/'stdout','wb') as out, open(data/'stderr','wb') as err:
 app=subprocess.Popen([binary,'--open'],env=env,stdout=out,stderr=err);holder=None
 try:
  desktop=Atspi.get_desktop(0)
  accessible=wait(lambda:next((n for n in children(desktop) if n.get_process_id()==app.pid),None),'App accessibility tree',seconds=45)
  click('Settings','page tab')
  entry=find('Scrub clipboard','entry');assert entry.get_component_iface().grab_focus();key('ctrl+alt+u');click('Save shortcuts','push button');wait(lambda:saved()['scrubShortcut']=='Ctrl+Alt+U','Shortcut settings not saved')
  clip('first@example.com second@example.com +44 7700 900123');key('ctrl+alt+u')
  click('Keep original','toggle button');click('Keep all in this category','push button',index=1);click('Copy scrubbed text','push button')
  wait(lambda:read()=='first@example.com [EMAIL_1] +44 7700 900123','Per-item/category review mismatch')
  holder=subprocess.Popen(['.artifacts/hold-shortcut'],stdin=subprocess.PIPE,stdout=subprocess.PIPE);assert holder.stdout.readline().strip()==b'ready'
  action('--open');click('Settings','page tab');entry=find('Scrub clipboard','entry');entry.get_component_iface().grab_focus()
  # The external grab prevents the recorder receiving this combination. Set only
  # the readonly DOM input through the accessibility text interface is forbidden;
  # instead record first, then reserve it before Save.
  holder.stdin.close();holder.wait();holder=None
  key('ctrl+alt+p');holder=subprocess.Popen(['.artifacts/hold-shortcut'],stdin=subprocess.PIPE,stdout=subprocess.PIPE);assert holder.stdout.readline().strip()==b'ready'
  click('Save shortcuts','push button');assert saved()['scrubShortcut']=='Ctrl+Alt+U'
  text=' '.join(Atspi.Text.get_text(n,0,-1) for n in walk(accessible) if n.get_role_name()=='status bar' and n.get_text_iface())
  assert 'unavailable' in text,'Missing conflict error'
  holder.stdin.close();holder.wait();holder=None
  click('Start at login','check box');wait(lambda:(pathlib.Path.home()/'.config/autostart/Scrub.desktop').exists(),'Autostart entry missing');click('Start at login','check box');wait(lambda:not (pathlib.Path.home()/'.config/autostart/Scrub.desktop').exists(),'Autostart entry retained')
  click('Keep mappings on this device','check box');wait(lambda:(data/'mappings.json').exists(),'Opt-in mapping not saved');assert (data/'mappings.json').stat().st_mode&0o777==0o600
  click('Clear all mappings','push button');click('Delete','push button');wait(lambda:not (data/'mappings.json').exists(),'Mapping clear failed')
  clip('cancel@example.com');key('ctrl+alt+u');find('Copy scrubbed text','push button');key('Escape');assert read()=='cancel@example.com'
 finally:
  if app.poll() is None and saved().get('autostart'):
   action('--open');click('Settings','page tab');click('Start at login','check box')
  if holder:holder.stdin.close();holder.wait()
  app.terminate();app.wait(timeout=10)
  clip('native-settings-test-complete')
print('Native shortcut change/conflict rollback, item/category review, autostart, opt-in 0600 storage, clear confirmation and Escape pass.')
