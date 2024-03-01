import './videocontrols.css'

type CB = (
  srcOrId?:string|MediaProvider|null, 
  videoOrImage?:HTMLVideoElement|HTMLImageElement
)=>void

export class MediaElementCreator {
  fileInput: HTMLInputElement;
  videoSelect: HTMLSelectElement;
  parentElement:HTMLElement;
  mediaOptions: MediaStreamConstraints;
  currentMediaElement: HTMLImageElement | HTMLVideoElement | null = null;
  oncreate?: CB;
  onstarted?: CB;
  ondelete?: CB;
  onended?: CB;
  ontargetchanged?: CB;

  
  controlsParent:HTMLElement;
  controlsDialog:HTMLDivElement;
  toggleDialogButton:HTMLButtonElement;
  currentTrack:MediaStreamTrack;

  constructor(
    parentElement: HTMLElement,
    callbacks?: {
      oncreate?: CB,
      onstarted?: CB,
      ondelete?: CB,
      onended?: CB,
      ontargetchanged?: CB
    },
    mediaOptions?: MediaStreamConstraints,
    autostart=true
  ) {
    this.parentElement = parentElement;
    this.mediaOptions = mediaOptions || {
      audio: false,
      video: {
        optional:[
          {minWidth: 320},
          {minWidth: 640},
          {minWidth: 1024},
          {minWidth: 1280},
          {minWidth: 1920},
          {minWidth: 2560},
          {minWidth: 3840},
        ]
      } as any
    };
    
    this.oncreate = callbacks?.oncreate;
    this.onstarted = callbacks?.onstarted;
    this.ondelete = callbacks?.ondelete;
    this.ontargetchanged = callbacks?.ontargetchanged;

    let controlsDiv = document.createElement('div');
    this.parentElement.appendChild(controlsDiv);

    this.createFileInputElement(controlsDiv);
    this.createVideoSelectElement(controlsDiv);

    // Initialize the controls dialog
    this.initializeControlsDialog(controlsDiv);

    if(autostart)
      setTimeout(()=>{ //give it a moment to enumerate
        if(this.videoSelect.value) this.getVideoStream({
          audio:false,
          video:{
            width:{ min:480, ideal:3840},
            height:{ min:320, ideal:2160},
            deviceId:this.videoSelect.value as string
          }});
      },100);
  }

  createFileInputElement(parent:HTMLElement) {
    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = 'image/*, video/*';
    this.fileInput.addEventListener('change', (event) => {
        const target = event.target as HTMLInputElement;
        if (target.files && target.files[0]) {
            const file = target.files[0];
            this.createMediaElement(file);
        }
    });
    this.fileInput.onclick = (ev:any) => {
      this.fileInput.value = "";
    }
    parent.appendChild(this.fileInput);
  }

  createVideoSelectElement(parent:HTMLElement) {
    this.videoSelect = document.createElement('select');
    this.setupVideoInputOptions();
    parent.appendChild(this.videoSelect);
    let button = document.createElement('button');
    button.innerHTML = "Stream";
    button.onclick = () => {
      this.setStream();
    }
    parent.appendChild(button);
  }

  setStream = () => {
    const options: MediaStreamConstraints = {
      ...this.mediaOptions,
      video: { 
        width:{ min:480, ideal:3840},
        height:{ min:320, ideal:2160},
        zoom:true,
        deviceId:this.videoSelect.value
      } as any
    };
    this.getVideoStream(options);
  }

  async setupVideoInputOptions() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter(device => device.kind === 'videoinput');

    this.videoSelect.innerHTML = videoDevices
      .map(device => `<option value="${device.deviceId}">${device.label || device.deviceId}</option>`)
      .join('');

    this.videoSelect.addEventListener('change', this.setStream);
  }

  async getVideoStream(options: MediaStreamConstraints) {
    try {

      const stream = await navigator.mediaDevices.getUserMedia(options);
      
      //no ios
      //const track = stream.getVideoTracks()[0];
      //let capture = new ImageCapture(track);
      //let capabilities = Promise.all([capture.getPhotoCapabilities(), capture.getPhotoSettings()]);
      //capabilities.then((res)=>{console.log("CAPTURE CAPABILITIES: ",...res);});

      this.createVideoElement(stream, (options?.video as any)?.deviceId);

      
      const [videoTrack] = stream.getVideoTracks();
      this.createControlElements(videoTrack);
      this.currentTrack = videoTrack;
    } catch (error) {
      console.error('Error accessing the webcam', error);
    }
  }

  // Helper to create a dropdown control for mode settings
  createSelectControl(labelText, options, currentSetting, onChangeCallback) {
    const label = document.createElement('label');
    label.textContent = labelText + ": ";
    const select = document.createElement('select');

    this.controlElements[labelText] = select; 

    options.forEach(option => {
        const optionElement = document.createElement('option');
        optionElement.value = option;
        optionElement.textContent = option;
        optionElement.selected = option === currentSetting;
        select.appendChild(optionElement);
    });

    select.addEventListener('change', () => onChangeCallback(select.value));
    if(this.controlsDialog)
      this.controlsDialog.appendChild(label); // This ensures it's inside the dialog)
    else this.parentElement.appendChild(label);
    label.appendChild(select);
  }

  // Helper to create a slider control for numeric values
  createSliderControl(labelText, capabilities, currentSetting, onChangeCallback) {
    const container = document.createElement('div');
    container.style.display = 'flex';
    container.style.justifyContent = 'space-between';
    container.style.alignItems = 'center';
    container.style.padding = '10px'; // Add padding for better spacing

    const label = document.createElement('label');
    label.textContent = labelText + ": ";
    label.style.flex = '2'; // Adjusted for relative sizing
    label.style.whiteSpace = 'nowrap'; // Prevent the label from wrapping
    label.style.overflow = 'hidden'; // Hide overflow
    label.style.textOverflow = 'ellipsis'; // Add ellipsis for overflow text
    label.style.fontSize = '0.9em'; // Relative font size

    const valueDisplay = document.createElement('span');
    valueDisplay.textContent = currentSetting;
    valueDisplay.style.fontFamily = 'Consolas, "Courier New", monospace';
    valueDisplay.style.flex = '1'; // Ensure this doesn't grow too much
    valueDisplay.style.textAlign = 'right'; // Align the text to the right
    valueDisplay.style.fontSize = '0.9em'; // Use relative sizing
    valueDisplay.style.width = '10%';
    valueDisplay.style.overflow = 'hidden'; // Hide overflow
    valueDisplay.style.textOverflow = 'ellipsis'; // Add ellipsis for overflow text

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = capabilities.min;
    slider.max = capabilities.max;
    slider.step = capabilities.step || 1; // Default step to 1 if not specified
    slider.value = currentSetting;
    slider.style.flex = '3'; // Allow the slider to grow, adjust as needed
    slider.style.maxWidth = '200px'; // Fixed width for the slider

    this.controlElements[labelText] = { control: slider, label: valueDisplay };

    slider.addEventListener('input', () => {
      const value = parseFloat(slider.value);
      valueDisplay.textContent = `${value}`; // Update the display value
      onChangeCallback(value);
    });
    
    // Determine where to append the slider control
    //if (labelText.toLowerCase().includes('zoom')) { 
    //    this.controlsParent.appendChild(container); // Directly on the parent for immediate access
    //} else {
        this.controlsDialog.appendChild(container); // Inside the dialog for other settings
    //}

    container.appendChild(label);
    container.appendChild(slider);
    container.appendChild(valueDisplay); // Append the value display to the container
  }

  // Helper to create toggle control for boolean values
  createToggleControl(labelText, currentState, onChangeCallback) {
    const label = document.createElement('label');
    label.textContent = labelText + ": ";
    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.checked = currentState;

    this.controlElements[labelText] = toggle;

    toggle.addEventListener('change', () => onChangeCallback(toggle.checked));
    if (this.controlsDialog) {
      this.controlsDialog.appendChild(label); // Inside the dialog for other settings
    } else {
      this.parentElement.appendChild(label); // Directly on the parent for immediate access 
    }
    label.appendChild(toggle);
  }

  // New helper for pointsOfInterest, which requires a unique approach
  createPointsOfInterestControl(track) {
    const poiButton = document.createElement('button');
    poiButton.textContent = "Set Points of Interest";
    poiButton.addEventListener('click', () => {
        // This example assumes a method to capture click events on the video to set points of interest
        // Implement your method to capture points of interest here
        // For simplicity, this is a placeholder for actual implementation
        console.log("Implement POI selection logic");
        // After selecting POIs, apply constraints with something like:
        // track.applyConstraints({ advanced: [{ pointsOfInterest: [{x: 0.5, y: 0.5}] }] });
    });
    
    this.parentElement.appendChild(poiButton);
  }


  initializeControlsDialog(parentElement) {
      // Create the dialog container
      this.controlsDialog = document.createElement('div');
      this.controlsDialog.style.display = 'none'; // Hidden by default

      Object.assign(this.controlsDialog.style,{
        position:'absolute',
        zIndex:'2',
        backgroundColor:'rgba(10,10,10,0.5)',
        flexDirection:'column'
      } as CSSStyleDeclaration);

      this.controlsDialog.setAttribute('class', 'controls-dialog');

      // Optionally, add a button to show/hide the dialog
      this.toggleDialogButton = document.createElement('button');
      
      this.toggleDialogButton.style.display = 'none'; //hidden till we access getUserMedia
      this.toggleDialogButton.textContent = 'Show Camera Settings';
      this.toggleDialogButton.addEventListener('click', () => {
          const isDisplayed = this.controlsDialog.style.display === 'flex';
          this.controlsDialog.style.display = isDisplayed ? 'none' : 'flex';
          this.toggleDialogButton.textContent = isDisplayed ? 'Show Camera Settings' : 'Hide Camera Settings';
      
          // Start or stop the monitoring loop based on the dialog visibility
          if (isDisplayed) {
              this.stopMonitoringLoop();
          } else {
              this.startMonitoringLoop(this.currentTrack); // Ensure `this.currentTrack` is updated to the current track elsewhere in your code
          }
      });


      parentElement.appendChild(this.toggleDialogButton);
      parentElement.appendChild(this.controlsDialog);
      this.controlsParent = parentElement;
      
  }

  controlElements:any = {};
  monitoringInterval;

  // Method to create controls based on the video track capabilities
  //https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints#exposuremode
  createControlElements(track) {
    const capabilities = track.getCapabilities();
    const settings = track.getSettings();
    this.toggleDialogButton.style.display = '';
    
    
    //console.log(capabilities); //check this for more settings we could add

    // Continue creating controls for each capability...
    // The following are additional examples for other settings

    // Handle the creation of controls for whiteBalanceMode, exposureMode, and focusMode
    [
      'whiteBalanceMode', 
      'exposureMode', 
      'focusMode',
      'resizeMode'
    ].forEach(setting => {
      if (capabilities[setting]) {
          this.createSelectControl(setting.charAt(0).toUpperCase() + setting.slice(1).replace(/([A-Z])/g, ' $1'), // Format the label text
              capabilities[setting], settings[setting], value => {
                  let constraint = {};
                  constraint[setting] = value;
                  track.applyConstraints({ advanced: [constraint] });
              });
      }
    });


    // Numeric options: colorTemperature, iso, etc.
    [
      'zoom',
      'colorTemperature', 
      'iso', 
      'brightness', 
      'contrast', 
      'saturation', 
      'sharpness', 
      'focusDistance',
      'exposureTime',
      'exposureCompensation',
      'frameRate'
    ].forEach(setting => {
        if (capabilities[setting]) {
            this.createSliderControl(setting.replace(/([A-Z])/g, ' $1'), // Add spaces before capital letters for readability
                capabilities[setting], settings[setting], value => {
                    let constraint = {};
                    constraint[setting] = value;
                    track.applyConstraints({ advanced: [constraint] });
                });
        }
    });

    // Boolean option: torch
    if ('torch' in capabilities) {
        this.createToggleControl('Torch', settings.torch, value => {
            track.applyConstraints({ advanced: [{ torch: value }] });
        });
    }

    // Special handling for pointsOfInterest as it requires custom logic
    if ('pointsOfInterest' in capabilities) {
        this.createPointsOfInterestControl(track);
    }

    // Handling for facingMode, aspectRatio, frameRate, height, width as dropdowns if they have discrete values
    ['facingMode', 'aspectRatio', 'frameRate', 'height', 'width'].forEach(setting => {
        if (capabilities[setting] && Array.isArray(capabilities[setting]) && capabilities[setting].length > 0) {
            this.createSelectControl(setting.replace(/([A-Z])/g, ' $1'), // Add spaces before capital letters for readability
                capabilities[setting], settings[setting], value => {
                    let constraint = {};
                    constraint[setting] = value;
                    track.applyConstraints({[setting]: value});
                });
        }
    });
  }

  clearControlElements() {
    // Clear existing controls from the dialog
    while (this.controlsDialog.firstChild) {
        this.controlsDialog.removeChild(this.controlsDialog.firstChild);
    }
    // Optionally, reset or remove the zoom control if it's outside the dialog
  }


  startMonitoringLoop(track) {
    if (this.monitoringInterval) {
        clearInterval(this.monitoringInterval);
    }

    let lastValues = {} as any;
    this.monitoringInterval = setInterval(() => {
        // Fetch current track settings
        const settings = track.getSettings();

        // Update control values
        for (const key in this.controlElements) {
          if(typeof settings[key] === 'undefined' || settings[key] !== lastValues[key]) continue;
          console.log(settings[key], typeof settings[key])
          lastValues[key] = settings[key];
          const controlInfo = this.controlElements[key];
          if (typeof controlInfo === 'object') { // For sliders with labels
            if(controlInfo.control && controlInfo.label) {
              controlInfo.control.value = settings[key];
              controlInfo.label.textContent = settings[key];
            } else if (controlInfo.tagName === 'SELECT') { // For select elements
              controlInfo.value = settings[key];
            } else if (controlInfo.type === 'checkbox') {
              controlInfo.checked = settings[key];
            }
          }
        }
    }, 1000); // 2fps -> 500ms per frame
  }

  stopMonitoringLoop() {
      if (this.monitoringInterval) {
          clearInterval(this.monitoringInterval);
          this.monitoringInterval = null;
      }
  }

  createMediaElement(file: File) {
    const url = URL.createObjectURL(file);
    if(this.oncreate) this.oncreate(file.name, undefined);
    
    if (file.type.startsWith('image/')) {
      this.createImageElement(url);
    } else if (file.type.startsWith('video/')) {
      this.createVideoElement(url);
    } else {
      console.error('Unsupported file type:', file.type);
    }
  }

  createImageElement(src: string) {
    const image = new Image();
    image.src = src;
    image.onload = () => {
      this.deinitMediaElement();
      this.parentElement.appendChild(image);
      this.currentMediaElement = image;
      if(this.ontargetchanged) this.ontargetchanged(src, image);
    };
  }

  createVideoElement(src: string | MediaStream, deviceId?: string) {

    this.deinitMediaElement();

    const video = document.createElement('video');
    video.classList.add('video-element');
    video.autoplay = true;

    video.loop = true;
    video.muted = true; // Mute to allow autoplay without user interaction
    
    
    if (typeof src === 'string') {
      video.src = src;
      if(this.oncreate) this.oncreate(src, video);
    } else {
      video.srcObject = src;
      video.onloadedmetadata = () => {
        if(this.onstarted) this.onstarted(deviceId, video);
      };
    }
    
    video.onplay = () => {
      if(this.onstarted) this.onstarted(deviceId || video.src, video);
    };

    video.onended = () => {
      if(this.onended) this.onended(video.src || deviceId, video);
    };

        // Create a container for the video and controls
    const videoContainer = document.createElement('div');
    videoContainer.className = 'video-container';
    videoContainer.appendChild(video);

    if(!deviceId) {
      // Create controls
      const controlsDiv = document.createElement('div');
      controlsDiv.className = 'video-controls';

      const playPauseBtn = document.createElement('button');
      playPauseBtn.innerText = '⏸️';
      playPauseBtn.onclick = () => {
          if (video.paused) {
              video.play();
              playPauseBtn.innerText = '⏸️';
          } else {
              video.pause();
              playPauseBtn.innerText = '▶️';
          }
      };

      const seekSlider = document.createElement('input');
      seekSlider.type = 'range';
      seekSlider.min = '0';
      seekSlider.max = '100';
      seekSlider.value = '0';
      seekSlider.oninput = (e) => {
          const seekTo = video.duration * (+seekSlider.value / 100);
          video.currentTime = seekTo;
      };

      video.ontimeupdate = () => {
          seekSlider.value = String((video.currentTime / video.duration) * 100);
      };

      controlsDiv.appendChild(playPauseBtn);
      controlsDiv.appendChild(seekSlider);

      videoContainer.appendChild(controlsDiv);
    }
    
    videoContainer.appendChild(video);
    this.parentElement.appendChild(videoContainer);

    this.currentMediaElement = video;
    if(this.ontargetchanged) this.ontargetchanged(deviceId || video.src, video);
  }

  deinitMediaElement() {
    this.toggleDialogButton.style.display = 'none';
    if (this.currentMediaElement) {
      if (this.currentMediaElement instanceof HTMLVideoElement && this.currentMediaElement.srcObject) {
        const tracks = (this.currentMediaElement.srcObject as MediaStream).getTracks();
        tracks.forEach(track => track.stop());
      }
      if(this.ondelete) this.ondelete(this.currentMediaElement.src || (this.currentMediaElement as HTMLVideoElement).srcObject, this.currentMediaElement);
      this.currentMediaElement.parentElement?.remove();
      this.currentMediaElement = null;
    }
  }
  
}