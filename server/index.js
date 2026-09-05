const path = require('path')
const express = require('express')
const http = require('http')
const { Server } = require('socket.io')

const app = express()
app.use(express.static(path.join(__dirname, '..', 'public')))

const server = http.createServer(app)
const io = new Server(server)

const PORT = process.env.PORT || 3000
server.listen(PORT, () => console.log(`Quiz server listening on port ${PORT}`))

module.exports = server
