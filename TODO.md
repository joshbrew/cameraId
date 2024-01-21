
- Image baseline averaging is a little jank, make sure you compare the same number of averaged images to get good subtraction in the raw image (the CSV is fine). Basically the canvas averaging method also lowers the final opacity so you need to use the same number of averaged images in the baseline and subtracted sample but this is a coding issue.

- RPi Web Server demo
- Capacitor mobile integration
- Google cloud/firebase/bigquery or something for direct image/video uploading to our database, sort by users 
    - login system? I think we'll just use GDrive for now with their ez oauth system
- Look into UVC camera support (what the Arducams are) using node or python on a local server packaged into the app, e.g. https://github.com/joelpurra/node-uvc to get control over camera gain/exposure etc.


- For hyperspectral, swap to the capacitor accelerometer API.
- multicolor hyperspectral images in single pass
- thread it for speeeeed
- download the images