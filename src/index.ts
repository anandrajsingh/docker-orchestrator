import express from "express"
import Docker, { Container } from "dockerode"

const app = express()
app.use(express.json())
const docker = new Docker({ socketPath: '/var/run/docker.sock' })

app.get("/", (req, res) => {
    res.json({ working: true })
})

app.get('/container/list', async (req, res) => {
    try {
        const containers = await docker.listContainers({ all: false })
        res.json(containers)
    } catch (err) {
        res.status(500).json(err)
    }
})


app.post('/container/create', async (req, res) => {
    const body = req.body;
    try {
        await new Promise<void>((resolve, reject) => {
            docker.pull(body.Image, (err: Error, stream: NodeJS.ReadableStream) => {
                if (err) return reject(err)
                docker.modem.followProgress(stream, (err) => (err ? reject(err) : resolve()))
            })
        })

        const container: Container = await docker.createContainer(body)

        await container.start()

        const data = await container.inspect()

        res.json(data)
    } catch (error) {
        res.status(500).json(error)
    }
})

app.post('/container/run', async (req, res) => {
    const body = req.body;
    const parsedCmd = body.Cmd.trim().split(" ")

    try {
        const [container, output] = await docker.run(`${body.Image}`, parsedCmd, process.stdout, { Tty: body.Tty })
        res.json(output)
    } catch (error) {
        res.status(500).json(error)
    }
})

app.post('/container/run/:id', async(req, res) => {
    const {code, Cmd } = req.body;
    const containerId = req.params.id

    const container = docker.getContainer(containerId)
    const data = await container.inspect()
    if(!data) return res.status(500).send("Container not found")
    
    const sanitizedCode = code.replace(/"/g, '\\"').replace(/`/g, '\\`');
    const execCmd = `${Cmd} "${sanitizedCode}"`

    try {
        const exec = await container.exec({
            Cmd: ["sh", "-c", execCmd],
            AttachStderr: true,
            AttachStdout: true
        })

        const stream = await exec.start({})
        let output = ""
        stream.on("data", (chunk) => (output += chunk.toString()))
        stream.on("end", () => res.send({output}))
    } catch (error) {
        console.error(error)
        res.status(500).send("Error executing code")
    }
})

app.get('/container/:id', async (req, res) => {
    const containerId = req.params.id
    try {
        const container = docker.getContainer(containerId)
        const data = await container.inspect()
        res.json(data)
    } catch (error) {
        res.status(500).json(error)
    }
})

app.delete('/container/:id', async (req, res) => {
    const containerId = req.params.id;

    try {
        const container = docker.getContainer(containerId)
        const data = await container.inspect()
        let status = data.State.Status

        switch (status) {
            case "running":
                await container.stop();
                await container.remove();
                break

            case "paused":
                await container.unpause()
                await container.stop();
                await container.remove();
                break

            case "restarting":
                let retries = 5;
                while (status === "restarting" && retries > 0) {
                    await new Promise(r => setTimeout(r, 1000))
                    const refreshed = await container.inspect()
                    status = refreshed.State.Status;
                    retries--;
                }
                if (status === "running") await container.stop();
                await container.remove();
                break;

            case "exited":
            case "created":
                await container.remove();
                break;

            case "dead":
                await container.remove({ force: true })
                break;

            case "removing":
                break;

            default:
                throw new Error(`Unknown container status: ${status}`);
        }

        res.json({ message: `Container ${data.Name} whose conainer id is ${containerId} deleted` })
    } catch (error) {
        res.status(500).json(error)
    }
})


app.listen(4000, () => console.log("Server running on port 4000"))