#!/usr/bin/env python3
"""Exercise real native notification delivery on an isolated D-Bus session."""
import dbus, dbus.service, dbus.mainloop.glib
from gi.repository import GLib
import os, pathlib, subprocess, threading, time, json

dbus.mainloop.glib.DBusGMainLoop(set_as_default=True)
bus = dbus.SessionBus()
name = dbus.service.BusName('org.freedesktop.Notifications', bus)
messages = []
class Notifications(dbus.service.Object):
 @dbus.service.method('org.freedesktop.Notifications', in_signature='', out_signature='as')
 def GetCapabilities(self): return ['body']
 @dbus.service.method('org.freedesktop.Notifications', in_signature='', out_signature='ssss')
 def GetServerInformation(self): return ('Scrub QA', 'Scrub QA', '1', '1.2')
 @dbus.service.method('org.freedesktop.Notifications', in_signature='susssasa{sv}i', out_signature='u')
 def Notify(self, app, replaces, icon, summary, body, actions, hints, timeout):
  messages.append(str(body)); return len(messages)
server = Notifications(bus, '/org/freedesktop/Notifications')
loop = GLib.MainLoop(); failures=[]
def run():
 data=pathlib.Path('.artifacts/notifications').resolve();data.mkdir(parents=True,exist_ok=True)
 (data/'settings.json').write_text(json.dumps(dict(language='en',welcomed=True,skipReview=True,keepMappings=False,autostart=False,dictionary=[],detectors={},scrubShortcut='Ctrl+Alt+S',restoreShortcut='Ctrl+Alt+R')))
 env=dict(os.environ,SCRUB_DATA_DIR=str(data),WEBKIT_DISABLE_DMABUF_RENDERER='1')
 binary=os.environ.get('SCRUB_BINARY','src-tauri/target/release/scrub-desktop')
 def clip(text):subprocess.run(['xclip','-selection','clipboard'],input=text.encode(),check=True)
 def action(flag, expected):
  count=len(messages);subprocess.run([binary,flag],env=env,check=True)
  end=time.monotonic()+8
  while len(messages)==count and time.monotonic()<end:time.sleep(.05)
  assert len(messages)>count and expected in messages[-1], 'Missing native notification: '+expected
 with open(data/'stdout','wb') as out,open(data/'stderr','wb') as err:
  app=subprocess.Popen([binary,"--open"],env=env,stdout=out,stderr=err)
  try:
   end=time.monotonic()+40
   while time.monotonic()<end:
    if subprocess.run(['xdotool','search','--onlyvisible','--name','^Scrub$'],capture_output=True).returncode==0:break
    time.sleep(.2)
   time.sleep(1)
   clip('notification@example.com');action('--scrub-clipboard','Scrubbed')
   clip('[EMAIL_1]');action('--restore-clipboard','Restored')
   clip('');action('--scrub-clipboard','Nothing to scrub')
   clip('ordinary words');action('--scrub-clipboard','No sensitive details')
   subprocess.run(['xclip','-selection','clipboard','-t','image/png','-i','src-tauri/icons/32x32.png'],check=True)
   action('--scrub-clipboard','Nothing to scrub')
   assert all('notification@example.com' not in message for message in messages)
  except Exception as error:failures.append(error)
  finally:
   app.terminate();app.wait(timeout=10);clip('notification-test-complete');GLib.idle_add(loop.quit)
threading.Thread(target=run,daemon=True).start();loop.run()
if failures:raise failures[0]
print('Five native D-Bus notifications delivered: scrub, restore, empty, no detections and non-text; no originals included.')
