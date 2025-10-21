/**
 * Dockerode Code Execution Service
 *
 * This script demonstrates how to use the 'dockerode' library to:
 * 1. Create a container based on a specified language image.
 * 2. Execute a snippet of code inside that container using 'exec'.
 * 3. Stream and capture the output (STDOUT and STDERR).
 * 4. Clean up the container afterward.
 *
 * Requirements:
 * - Docker daemon must be running and accessible.
 * - Node.js must have the 'dockerode' package installed (npm install dockerode).
 */
const Docker = require('dockerode');
const { Writable } = require('stream');

// Initialize Dockerode. It automatically finds the Docker socket on Linux/macOS
// or connects via environment variables on Windows.
const docker = new Docker();

/**
 * Maps languages to the appropriate Docker image and execution command.
 */
const executionEnvironments = {
    // Note: Using 'slim' images for smaller download sizes
    'python': {
        Image: 'python:3-slim',
        Cmd: ['/bin/sh', '-c'],
        // The actual code execution command will be constructed dynamically
    },
    'javascript': {
        Image: 'node:lts-alpine',
        Cmd: ['/bin/sh', '-c'],
    },
    // You can add more environments like 'java', 'go', 'bash', etc.
};

/**
 * Executes a given code snippet inside a temporary Docker container.
 *
 * @param {string} language - The programming language environment (e.g., 'python').
 * @param {string} code - The code snippet to execute.
 * @returns {Promise<string>} The captured output (STDOUT/STDERR).
 */
async function runCodeInContainer(language, code) {
    const env = executionEnvironments[language];
    if (!env) {
        throw new Error(`Unsupported language environment: ${language}`);
    }

    // --- 1. Define the Execution Command ---
    let execCmd;
    const sanitizedCode = code.replace(/"/g, '\\"').replace(/`/g, '\\`'); // Basic command line sanitization

    switch (language) {
        case 'python':
            // Executes code directly using the Python interpreter's -c flag
            execCmd = `python -c "${sanitizedCode}"`;
            break;
        case 'javascript':
            // Executes code directly using the Node interpreter's -e flag
            execCmd = `node -e "${sanitizedCode}"`;
            break;
        default:
            throw new Error(`Execution command not defined for ${language}`);
    }

    const command = [...env.Cmd, execCmd];
    let container = null;
    let output = '';

    // A custom Writable stream to capture the output of the execution
    const outputCapture = new Writable({
        write(chunk, encoding, callback) {
            output += chunk.toString();
            callback();
        }
    });

    try {
        // --- 2. Create the Container ---
        console.log(`[INFO] Creating container with image: ${env.Image}`);
        
        container = await docker.createContainer({
            Image: env.Image,
            AttachStdout: true,
            AttachStderr: true,
            Tty: false, // Must be false for consistent streaming of output
            OpenStdin: false,
            // Automatically remove the container on exit if possible (good practice)
            HostConfig: {
                AutoRemove: true 
            }
        });

        // --- 3. Start the Container ---
        await container.start();
        console.log(`[INFO] Container ${container.id.substring(0, 12)} started.`);


        // --- 4. Define and Start the Execution Process ---
        console.log(`[INFO] Executing command: ${execCmd}`);
        const exec = await container.exec({
            Cmd: command,
            AttachStdout: true,
            AttachStderr: true,
            Tty: false
        });

        // --- 5. Attach and Collect Output ---
        const stream = await exec.start({ hijack: true, stdin: true });

        // Pipe the stream to our capture object
        docker.modem.demuxStream(stream, outputCapture, outputCapture);

        // Wait for the execution command to complete
        await new Promise((resolve, reject) => {
            stream.on('end', resolve);
            stream.on('error', reject);
        });

        // Optional: Get the exit code of the execution
        const execInspect = await exec.inspect();
        if (execInspect.ExitCode !== 0) {
            // If the code failed, the output captured likely contains the error message
            console.error(`[ERROR] Code execution failed with exit code: ${execInspect.ExitCode}`);
        }

        return output.trim();

    } catch (error) {
        // Handle creation/start errors (e.g., image not found, Docker unreachable)
        console.error(`[FATAL] Docker operation error:`, error.message);
        throw new Error(`Failed to execute code: ${error.message}`);
    } finally {
        // --- 6. Cleanup (Highly Critical) ---
        // If the container was created but failed to auto-remove or is still running
        if (container) {
            try {
                const info = await container.inspect();
                if (info.State.Running) {
                    console.log(`[INFO] Stopping container ${container.id.substring(0, 12)}...`);
                    await container.stop({ t: 1 }); // Stop after 1 second
                }
                // If AutoRemove: true was set, this might be redundant, but safe to include
                await container.remove(); 
                console.log(`[INFO] Container ${container.id.substring(0, 12)} removed.`);
            } catch (cleanupError) {
                // Ignore cleanup errors if container is already gone or stopping
                console.warn(`[WARN] Failed to clean up container: ${cleanupError.message}`);
            }
        }
    }
}

// ==========================================================
// --- Example Usage ---
// ==========================================================

async function main() {
    const pythonCode = `
import time
print("Starting execution...")
# Simulate a computation
result = 15 + 27 * 2
time.sleep(0.5) 
print(f"The result is: {result}")
`;

    const jsCode = `
// JavaScript environment example
const user = 'Dockerode';
console.log('Node.js says hello to ' + user);
`;

    const errorPythonCode = `
# This code will intentionally fail
print("This runs.")
raise Exception("Simulated Runtime Error!")
`;

    console.log('\n======================================');
    console.log('1. RUNNING PYTHON CODE (SUCCESS)');
    console.log('======================================');
    try {
        const pythonOutput = await runCodeInContainer('python', pythonCode);
        console.log('\n--- PYTHON EXECUTION OUTPUT ---');
        console.log(pythonOutput);
        console.log('-------------------------------\n');
    } catch (e) {
        console.error(`Execution failed: ${e.message}`);
    }

    // ---
    console.log('\n======================================');
    console.log('2. RUNNING JAVASCRIPT CODE (SUCCESS)');
    console.log('======================================');
    try {
        const jsOutput = await runCodeInContainer('javascript', jsCode);
        console.log('\n--- JAVASCRIPT EXECUTION OUTPUT ---');
        console.log(jsOutput);
        console.log('----------------------------------\n');
    } catch (e) {
        console.error(`Execution failed: ${e.message}`);
    }

    // ---
    console.log('\n======================================');
    console.log('3. RUNNING PYTHON CODE (ERROR)');
    console.log('======================================');
    try {
        const errorOutput = await runCodeInContainer('python', errorPythonCode);
        console.log('\n--- PYTHON ERROR OUTPUT ---');
        console.log(errorOutput);
        console.log('---------------------------\n');
    } catch (e) {
        console.error(`Execution failed: ${e.message}`);
    }
}

main();

// Note on `dockerode` setup:
// For production, ensure you handle error conditions like the image
// not existing. You may want to call `docker.pull(env.Image)` first, 
// wait for it to complete, and then proceed with creation.
