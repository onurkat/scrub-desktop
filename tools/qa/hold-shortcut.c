#include <X11/Xlib.h>
#include <X11/keysym.h>
#include <stdio.h>
static int failed = 0;
static int on_error(Display *display, XErrorEvent *event) { (void)display; (void)event; failed = 1; return 0; }
int main(void) {
  Display *display = XOpenDisplay(NULL);
  if (!display) return 1;
  XSetErrorHandler(on_error);
  XGrabKey(display, XKeysymToKeycode(display, XK_P), ControlMask | Mod1Mask, DefaultRootWindow(display), False, GrabModeAsync, GrabModeAsync);
  XSync(display, False);
  if (failed) { XCloseDisplay(display); return 2; }
  puts("ready"); fflush(stdout);
  (void)getchar();
  XCloseDisplay(display);
  return 0;
}
