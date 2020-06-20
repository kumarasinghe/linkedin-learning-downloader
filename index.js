// author: Naveen Kumarasinghe <dndkumarasinghe@gmail.com
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const fetch = require("node-fetch");
const config = require('./config');
var path = require("path");
const DOWNLOAD_DIR = path.join(__dirname, 'downloads')
let courseLinks, browser, page;


// main
(async () => {

    // read course list
    if (!(courseLinks = fs.readFileSync('./courselinks.txt', { encoding: 'utf8' }))) {
        console.error('Could not read courselinks.txt')
        return
    }

    courseLinks = courseLinks.split('\n')
    console.log(`Found ${courseLinks.length} courses.`)

    // create download dir
    fs.existsSync(DOWNLOAD_DIR) || fs.mkdirSync(DOWNLOAD_DIR)
    console.log(`Download directory:${DOWNLOAD_DIR}`)

    // start chrome
    browser = await puppeteer.launch({
        "headless": false,
        "defaultViewport": null,
        "executablePath": config.chromeExecutablePath,
        "userDataDir": './chrome-session',
        args: [
            '--disable-web-security',
            '--auto-open-devtools-for-tabs'
        ]
    })

    // get first tab
    page = (await browser.pages())[0]

    // attach download button
    page.on('domcontentloaded', () => {

        page.evaluate(() => {
            return new Promise((resolve) => {
                let btn = document.createElement('button')
                btn.innerHTML = 'DOWNLOAD'
                btn.style = 'position:absolute; top:0; right:0; z-index:100000; width:200px; height:80px;'
                btn.onclick = resolve
                document.body.prepend(btn)
            })
        })
            .then(() => {
                page.removeAllListeners('domcontentloaded')
                downloadCourses()
            })
            .catch((err) => { })

    })

    // go to start page
    await page.goto(config.startPage, { waitUntil: "networkidle2", timeout: 0 })

    await page.evaluate(() => {
        alert('Sign in first, and click the Download button top right side.')
    })

})()


async function downloadCourses() {

    for (let i = 0; i < courseLinks.length; ++i) {

        let courseURL = courseLinks[i]
        console.log(`Parsing course ${i + 1} of ${courseLinks.length}: ${courseURL}`)
        await page.goto(courseURL, { waitUntil: "networkidle2", timeout: 0 })
        await page._client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOAD_DIR }) // set download dir

        // calculate resume position
        let downloadedFileCount = fs.readdirSync(DOWNLOAD_DIR).filter(fn => fn.endsWith('.mp4')).length
        if(downloadedFileCount){ 
            console.log(`Resuming download from lesson ${downloadedFileCount}...`)
            --downloadedFileCount
        }

        let downloadStats = await downloadCurrentCourse(downloadedFileCount)

        if (downloadStats.isComplete) {
            console.log('Course downloaded successfully!\nMoving files...')
            // move files
            let COURSE_DIR = path.join(DOWNLOAD_DIR, downloadStats.courseTitle)
            fs.existsSync(COURSE_DIR) || fs.mkdirSync(COURSE_DIR)

            let downloadFileList = fs.readdirSync(DOWNLOAD_DIR).filter(fn => fn.endsWith('.mp4'))
            downloadFileList.forEach((filename) => {
                moveIntoDir(filename, `${COURSE_DIR}/${baseName}`)
            })

        }
        else {
            console.error('Course downloading unsuccessful! Retrying...')
            --i
        }

    }

    console.log('Program ended.')

}


async function downloadCurrentCourse(startLesson) {

    return new Promise(async (resolve) => {

        // start parsing
        let courseTitle = await page.evaluate((startLesson, VIDEO_LOAD_WAIT) => {

            if(startLesson)(`Resuming download from lesson ${startLesson + 1}...`)

            return new Promise(async (resolve) => {

                let SELECTOR_CHAPTER_EXPANDERS = '.classroom-toc-chapter__toggle'
                let SELECTOR_LESSONS = '[data-control-name="toc_item"]'

                // expand chapters on sidebar except the first
                let chapterNodes = document.querySelectorAll(SELECTOR_CHAPTER_EXPANDERS)
                for (let i = 1; i < chapterNodes.length; ++i) { chapterNodes[i].click() }

                // get lesson nodes
                let lessonNodes = document.querySelectorAll(SELECTOR_LESSONS)

                // click each lesson node and grab the video source
                for (let i = startLesson; i < lessonNodes.length; ++i) {

                    console.log(`Parsing lesson ${(i + 1)}/${lessonNodes.length}...`)
                    let lessonNode = lessonNodes[i]
                    if (lessonNode.innerText.toLowerCase().includes('quiz')) { continue } // skip quizes
                    lessonNode.click()	// play lesson

                    // wait and get video URL
                    let videoURL = await new Promise(resolve => {
                        let interval = setInterval(() => {

                            let player = document.querySelector('video')
                            if (player && player.src && !player.src.includes('0123456789')) {
                                clearInterval(interval)
                                resolve(player.src)
                                player.src = '0123456789'	// mark dirty
                            }

                            // player crashed
                            let buttons = document.querySelectorAll('button')
                            buttons.forEach((button) => {
                                if (button.innerText.includes('Try again')) {
                                    resolve()
                                }
                            })

                        }, VIDEO_LOAD_WAIT)
                    })


                    let courseTitle = document.querySelector('h1').innerText.trim().replace(/[^a-zA-Z ]/g, "")

                    // player crashed
                    if (!videoURL) {
                        resolve()
                        return
                    }

                    // download file through browser
                    let filename = courseTitle + ' - ' + (i + 1) + ' - ' + lessonNode.innerText.split('\n')[0].replace(/[^a-zA-Z ]/g, "") + '.mp4'
                    console.log(`Downloading:\n${filename}`)

                    let res = await fetch(videoURL, { credentials: 'include' })
                    let blob = await res.blob()
                    let a = document.createElement("a")
                    a.href = URL.createObjectURL(blob)
                    a.download = filename
                    a.click()

                }

                console.log(`Finished downloading ${courseTitle}!`)
                resolve(courseTitle)

            })

        }, startLesson, config.videoLoadWait)


        // download success
        if (courseTitle) {
            resolve({ isComplete: true, courseTitle: courseTitle })
        }
        // download fail
        else {
            resolve({ isComplete: false, courseTitle: courseTitle })
        }

    })

}


function moveIntoDir(filename, dir) {

    let baseName = path.basename(filename)
    fs.renameSync(filename, `${dir}/${baseName}`)

}