import path from 'path'
import multer from 'multer'

export const upload = multer({
    storage: multer.diskStorage({}),
    fileFilter: (req, file, cb) => {
        let ext = path.extname(file.originalname)

        if(ext !== ".jpg" && ext !== ".jpeg" && ext !== ".png"){
            cb(new Error("file type is not supported"))
            return;
        }
        cb(null, true)
    }
})