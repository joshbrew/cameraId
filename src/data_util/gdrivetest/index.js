/* 
    esbuild + nodejs development server. 
    Begin your javascript application here. This file serves as a simplified entry point to your app, 
    all other scripts you want to build can stem from here if you don't want to define more entryPoints 
    and an outdir in the bundler settings.

    Just ctrl-A + delete all this to get started on your app.

*/

import { GDrive } from '../BFS_GDrive';

export const apiKey = "AIzaSyCqeebtrrt1VZh6oqqEFPCglTk6HkRlnrw";
export const clientId = "454181160578-ngnp0n8bconuso73ta12ogn72189a10b.apps.googleusercontent.com";

const gdrive = new GDrive(apiKey, clientId);

const form = document.getElementById('apiForm');
const authButton = document.getElementById('auth-button');

form.addEventListener('submit', async (event) => {
    event.preventDefault(); // Prevent the form from submitting normally
    
    // Check if the form is valid
    if (form.checkValidity()) {
        const apiKey = document.getElementById('apikey').value.trim();
        const clientId = document.getElementById('clientid').value.trim();
        const directory = document.getElementById('directory').value.trim();
        const useId = document.getElementById('useId').checked;
        
        if(useId) {
            gdrive.directoryId = directory;
        }
        else {
            gdrive.directory = directory;
            gdrive.directoryId = '';

        }

        document.getElementById('file-browser-container').innerHTML = '';
        
        // Initialize GDrive with new API key and Client ID
        await gdrive.initGapi(apiKey, clientId);
        // Re-enable the auth button
        authButton.disabled = false;
        authButton.click();
  } else {
        // If the form is not valid, display an alert or a message
        alert('Please fill in all required fields correctly.');
  }
});

authButton.addEventListener('click', async () => {
    if(!gdrive.isLoggedIn) 
        try {
            await gdrive.handleUserSignIn();
            authButton.disabled = true; // Disable the auth button after sign-in
        } catch (error) {
            console.error('Error signing in:', error);
        }
    
    if(gdrive.isLoggedIn) gdrive.createFileBrowser('file-browser-container');
});