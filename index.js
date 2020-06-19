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
        "userDataDir": './chrome-session',
        args: [
            '--disable-web-security',
            '--auto-open-devtools-for-tabs'
        ]
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
        if (await downloadCurrentCourse() == false) { --i }

    }

}


async function downloadCurrentCourse() {

    return new Promise(async (resolve) => {


        // start parsing
        page.evaluate((VIDEO_LOAD_WAIT) => {

            return new Promise(async (resolve) => {

                let SELECTOR_CHAPTER_EXPANDERS = '.classroom-toc-chapter__toggle'
                let SELECTOR_LESSONS = '[data-control-name="toc_item"]'

                // expand chapters on sidebar except the first
                let chapterNodes = document.querySelectorAll(SELECTOR_CHAPTER_EXPANDERS)
                for (let i = 1; i < chapterNodes.length; ++i) { chapterNodes[i].click() }

                // get lesson nodes
                let lessonNodes = document.querySelectorAll(SELECTOR_LESSONS)

                // get course title
                let courseTitle = document.querySelector('h1').innerText.trim().replace(/[^a-zA-Z ]/g, "")

                // click each lesson node and grab the video source
                for (let i = 0; i < lessonNodes.length; ++i) {

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

                    let filename = courseTitle + ' - ' + (i + 1) + ' - ' + lessonNode.innerText.split('\n')[0].replace(/[^a-zA-Z ]/g, "") + '.mp4'
                    console.log(`Downloading ${filename}...`)

                    let res = await fetch(videoURL, {credentials: 'include'})
                    let blob = await res.blob()
                    let a = document.createElement("a")
                    a.href = URL.createObjectURL(blob)
                    a.download = filename
                    a.click()

                }

                console.log(`Finished downloading ${courseTitle}!`)
                resolve()

            })

        }, config.videoLoadWait)

            .then(async () => {
                resolve()
            })
            .catch((err) => { resolve(false) })

    })

}