// author: Naveen Kumarasinghe <dndkumarasinghe@gmail.com
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const fetch = require("node-fetch");
const config = require('./config');
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
    fs.existsSync('downloads') || fs.mkdirSync('downloads')

    // start chrome
    browser = await puppeteer.launch({
        "headless": false,
        "defaultViewport": null,
        "executablePath": config.chromeExecutablePath,
        "userDataDir": './chrome-session'
    })

    // get first tab
    page = (await browser.pages())[0]

    // inject keyboard shortcut on every page relaod
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
        if (await parseCourseData() == false) { --i }

    }

}


async function parseCourseData() {

    return new Promise(async (resolve) => {

        // get parse resume lesson
        let courseDir = './downloads/' + await page.evaluate(() => {
            return document.querySelector('h1').innerText.trim().replace(/[^a-zA-Z ]/g, "")
        })

        let parseStart = 0
        if (fs.existsSync(courseDir)) {
            parseStart = fs.readdirSync(courseDir).length
            console.log('Resuming parsing from lesson:', parseStart)
        }

        // start parsing
        page.evaluate((parseStart, VIDEO_LOAD_WAIT) => {

            return new Promise(async (resolve) => {

                let SELECTOR_CHAPTER_EXPANDERS = '.classroom-toc-chapter__toggle'
                let SELECTOR_LESSONS = '[data-control-name="toc_item"]'

                // expand chapters on sidebar except the first
                let chapterNodes = document.querySelectorAll(SELECTOR_CHAPTER_EXPANDERS)
                for (let i = 1; i < chapterNodes.length; ++i) { chapterNodes[i].click() }

                // get lesson nodes
                let lessonNodes = document.querySelectorAll(SELECTOR_LESSONS)

                // click each lesson node and grab the video source
                let videoArray = []

                for (let i = parseStart; i < lessonNodes.length; ++i) {

                    console.log(`Parsing video ${(i + 1)} of ${lessonNodes.length}...`)
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

                            // click retry if player crashed. will throw and error restart the downlaod
                            let buttons = document.querySelectorAll('button')
                            buttons.forEach((button) => {
                                if (button.innerText == 'Try again') {
                                    throw new Error('Player failure')
                                }
                            })

                        }, VIDEO_LOAD_WAIT)
                    })

                    let title = (i + 1) + '.' + lessonNode.innerText.split('\n')[0].replace(/[^a-zA-Z ]/g, "")
                    videoArray.push({ 'title': title, 'url': videoURL })
                }

                // get course title
                let courseTitle = document.querySelector('h1').innerText.trim().replace(/[^a-zA-Z ]/g, "")

                resolve({ "courseTitle": courseTitle, "videoURLArray": videoArray })

                document.write('<h3>See terminal for download progress...</h3>')

            })

        }, parseStart, config.videoLoadWait)

            .then(async (courseData) => {
                await downloadVideos(courseData)
                resolve()
            })
            .catch((err) => { resolve(false) })

    })

}


async function downloadVideos(courseData) {

    console.log('Downlaoding course :', courseData.courseTitle)
    let downloadDir = `./downloads/${courseData.courseTitle}`
    fs.existsSync(downloadDir) || fs.mkdirSync(downloadDir)
    let videoURLArray = courseData.videoURLArray

    return new Promise(async (resolve) => {

        for (let i = 0; i < videoURLArray.length; ++i) {
            let videoData = videoURLArray[i]
            let outFilePath = `${downloadDir}/${videoData.title}.mp4`

            console.log(`Downloading lesson ${i + 1} of ${videoURLArray.length} : ${videoData.title}`)

            await downloadFile(
                videoData.url.replace('https', 'http'),
                outFilePath
            )
        }

        resolve()

    })

}


async function downloadFile(url, path) {

    const res = await fetch(url)
    const fileStream = fs.createWriteStream(path)

    await new Promise((resolve) => {
        res.body.pipe(fileStream)
        res.body.on("error", (err) => { console.log(err) })
        fileStream.on("finish", function () { resolve() })
    })
}