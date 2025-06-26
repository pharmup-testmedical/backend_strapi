import path from 'path'
import fs from 'fs'
import { winston, formats } from '@strapi/logger'

const { prettyPrint, levelFilter } = formats

// ✅ Use project root to avoid /dist issues
const projectRoot = process.cwd()
const logDir = path.join(projectRoot, 'logs')
const logFile = path.join(logDir, 'strapi.log')

// ✅ Ensure log folder exists
if (!fs.existsSync(logDir)) {
    console.log(`🛠 Creating logs directory at: ${logDir}`)
    fs.mkdirSync(logDir, { recursive: true })
}

export default {
    transports: [
        new winston.transports.Console({
            level: 'debug',
            // level: 'http',
            format: winston.format.combine(
                // levelFilter('http'),
                prettyPrint({ timestamps: 'YYYY-MM-DD hh:mm:ss.SSS' })
            ),
        }),
        new winston.transports.File({
            filename: logFile,
            level: 'debug',
            format: winston.format.combine(
                winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
                winston.format.json()
            ),
        }),
    ],
}
