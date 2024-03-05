Spectral Data Sampling notes:

1. Before we sample we take a baseline image of the light reflected unadulterated off a plain white sheet of paper, that is used to subtract the following samples from it to receive a reflectance spectrum. 

2. With the baseline image set, point the spectrometer box at an illuminated substance and click the capture button to take an averaged sample over 10 frames. 

3. You can custom label (defaults to classifier's guess (probably wrong!)) and save each image to your phone or desktop, and if you set your own API keys (until we make our hosted version public) you can upload samples to google drive directly including the raw images and spectral csvs representing the accumulated intensities along the x-axis with the raw R,G,B and summed values for each column of pixels in the image. 

We're fixing the resulting images to 800x600 (or 800rows x 4cols csvs) at the moment just to conserve on data and thread performance and to standardize resolutions between different possible cameras to make the classification easier. In general this is fine as our homemade spectrometers likely won't resolve finer details but you can adjust modelInpHeight and modelInpWidth in the code or when using custom ONNX models.

More notes:

This is otherwise known as Raman spectroscopy, but this is our backwoods variation using web rendering tricks and RGB pixel value counting. The split light being imaged is a literal light FFT so the pixel intensities can tell us all about the molecular properties within UV to near-Infrared ranges without more specialized sensors.

Each image sample in spectral classification mode will currently accumulate 10 images and average the result as an image. If the baseline is set, the program subtracts the averaged sample from the baseline result to give you an emission spectra which should match the relative reflectance of the substance compared to baseline. This spectra is considered to be the accumulated pixel intensities for each column of pixels which should more or less correspond to a single wavelength depending on how vertical the actual spectral result is.

The averaging cleans up image noise, and the baseline subtraction removes the main known component to give us the unique raw data in the samples and more or less generates the same curves that labs are looking at with their own spectrometers. Negative values are zeroed out and assumed to be extraneous or outliers.

We should probably normalize that result so that we are reporting actual percentages of reflectance of per measured wavelength but right now the result is a simple subtraction of two averaged samples which is enough to feed into a magical XGBoost classifier. 