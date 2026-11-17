1: Fixed Rive companion context loss by passing buffer and src on init to prevent blank canvas.
2: Restored Rive listeners, rendering state, and surface size on tab reactivation.
3: Split mascot interactions into upper forehead tap (meow/jump) and lower chin hold (purr).
4: Suppressed forehead click triggers when releasing chin petting so purr is never canceled.
5: Verified mascot host, home screen, and final lock tests pass with zero token violations.
