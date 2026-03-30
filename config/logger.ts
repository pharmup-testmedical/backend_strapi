import path from 'path'
import fs from 'fs'
import { winston, formats } from '@strapi/logger'
import DailyRotateFile from 'winston-daily-rotate-file'

const { prettyPrint } = formats

const projectRoot = process.cwd()
const logDir = path.join(projectRoot, 'logs')

// Ensure log folder exists
if (!fs.existsSync(logDir)) {
    console.log(`Creating logs directory at: ${logDir}`)
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

        // ✅ Daily rotating file transport
        new DailyRotateFile({
            dirname: logDir,
            filename: 'strapi-%DATE%.log',
            datePattern: 'YYYY-MM-DD',
            level: 'debug',
            zippedArchive: true,        // compress old logs
            maxSize: '20m',             // optional: split if >20MB
            maxFiles: '14d',            // keep logs for 14 days
            format: winston.format.combine(
                winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
                winston.format.json()
            ),
        }),
    ],
}