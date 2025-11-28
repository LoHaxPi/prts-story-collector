const axios = require('axios');
const cheerio = require('cheerio');
const readline = require('readline-sync');
const fs = require('fs');

const BASE_URL = 'https://prts.wiki';
const MAIN_PAGE_URL = `${BASE_URL}/w/%E6%83%85%E6%8A%A5%E5%A4%84%E7%90%86%E5%AE%A4`;

async function main() {
    console.log('PRTS Wiki Story Scraper');
    let activityName = process.argv[2];
    if (!activityName) {
        if (!process.stdin.isTTY) {
            console.error("错误：检测到非交互式环境。请在命令行提供活动名称。");
            process.exit(1);
        }
        activityName = readline.question('请输入活动名称 (例如: 众生行记): ');
    }

    if (!activityName) {
        console.log('未输入活动名称，退出。');
        return;
    }

    // Helper to normalize URL
    const getFullUrl = (href) => {
        if (!href) return null;
        if (href.startsWith('http')) return href;
        if (href.startsWith('/')) return BASE_URL + href;
        return BASE_URL + '/w/' + href;
    };

    // Helper to extract content
    const extractStoryContent = async (url, titlePrefix) => {
        try {
            const res = await axios.get(url);
            const $ = cheerio.load(res.data);

            // Remove footer/navigation elements BEFORE extracting text
            $('.navbox').remove();
            $('.navbox-group').remove();
            $('.navbox-list').remove();
            $('.navbox-subgroup').remove();
            $('table.navbox').remove();
            $('.catlinks').remove();
            $('.printfooter').remove();
            $('.mw-footer').remove();
            $('#catlinks').remove();
            $('.mw-hidden-catlinks').remove();
            $('.navigation-not-searchable').remove();


            const mainContent = $('.mw-parser-output');
            let rawScript = mainContent.text();

            // If [HEADER is found, slice from there to avoid noise
            const headerIndex = rawScript.indexOf('[HEADER');
            if (headerIndex !== -1) {
                rawScript = rawScript.substring(headerIndex);
            } else {
                // If no [HEADER in text, check if it's in the raw HTML
                const rawMatch = res.data.match(/(\[HEADER[\s\S]*)/);
                if (rawMatch) {
                    rawScript = rawMatch[1];
                }
            }

            const lines = rawScript.split('\n');
            const parsedLines = [];
            let isScriptBlock = headerIndex !== -1 || rawScript.startsWith('[HEADER');

            for (let line of lines) {
                line = line.trim();
                if (!line) continue;

                // STRICT FILTERING for raw extraction
                // 1. Skip lines that are too long (likely minified code)
                if (line.length > 300) continue;

                // 2. Skip HTML tags
                if (line.startsWith('<')) continue;

                // 3. Skip CSS/JS structure
                if (line.includes('{') || line.includes('}') || line.includes('function(') ||
                    line.includes('var ') || line.includes('const ') || line.includes('let ') ||
                    line.includes('return ') || line.includes('console.') || line.includes('document.') ||
                    line.includes('window.') || line.includes('ele.') || line.includes('Math.') ||
                    line.includes('if(') || line.includes('else') || line.includes('switch') ||
                    line.includes('case ') || line.includes('default:') || line.includes('break;') ||
                    line.includes('system.')) continue;

                // 4. Skip HTML entities start
                if (line.startsWith('&')) continue;

                // 5. Skip URLs (Asset lists)
                if (line.includes('http:') || line.includes('https:')) continue;

                // 6. Skip lines ending with ; (Code statements)
                if (line.endsWith(';')) continue;

                // 7. Skip lines with assignments (Code)
                if (line.includes(' = ')) continue;

                // 8. AVG Command Filters (New)
                if (line.startsWith('char:') || line.startsWith('tween:') || line.startsWith('image:') ||
                    line.startsWith('override:') || line.startsWith('background:') || line.startsWith('blocker:') ||
                    line.startsWith('cameraeffect:') || line.startsWith('grayscale:') || line.startsWith('camerashake:') ||
                    line.startsWith('character:') || line.startsWith('characteraction:') || line.startsWith('move:') ||
                    line.startsWith('jump:') || line.startsWith('shake:') || line.startsWith('zoom:') ||
                    line.startsWith('exit:') || line.startsWith('charactercutin:') || line.startsWith('charslot:') ||
                    line.startsWith('curtain:') || line.startsWith('delay:') || line.startsWith('decision:') ||
                    line.startsWith('dialog:') || line.startsWith('header:') || line.startsWith('hideitem:') ||
                    line.startsWith('imagerotate:') || line.startsWith('imagetween:') || line.startsWith('gridbg:') ||
                    line.startsWith('verticalbg:') || line.startsWith('largebg:') || line.startsWith('largeimg:') ||
                    line.startsWith('multiline:') || line.startsWith('musicvolume:') || line.startsWith('soundvolume:') ||
                    line.startsWith('playmusic:') || line.startsWith('playsound:') || line.startsWith('predicate:') ||
                    line.startsWith('showitem:') || line.startsWith('skipnode:') || line.startsWith('stopmusic:') ||
                    line.startsWith('stopsound:') || line.startsWith('sticker:') || line.startsWith('theater:') ||
                    line.startsWith('timerclear:') || line.startsWith('timersticker:') || line.startsWith('video:')) {
                    continue;
                }

                // 9. JSON/Object Key Filters (New - Stricter)
                // Matches keys like action: "edit", page: "", bot: true, text: dat, token: token
                if (line.match(/^[a-z0-9_]+:\s*[a-z0-9_"'\d\[]/i)) continue;
                if (line.includes('bot:') || line.includes('text:') || line.includes('token:') ||
                    line.includes('flag:') || line.includes('mode:')) continue;

                // 10. Comment Filters (New)
                if (line.startsWith('*') || line.startsWith('/*') || line.startsWith('//')) continue;

                // 11. Stage List/Header Filters (New)
                if (line.includes('·') || line === '特殊' || line === '剧情' || line === '主线' || line === '支线' ||
                    line === '活动剧情一览' || line === '危机合约' || line === '集成战略' || line === '生息演算') {
                    continue;
                }

                // 12. Match [name="Name"] Text
                const nameMatch = line.match(/^\[name="([^"]+)"(?:,.*?)?\]\s*(.*)$/);
                if (nameMatch) {
                    const name = nameMatch[1];
                    const text = nameMatch[2];
                    if (text) {
                        parsedLines.push(`${name} : ${text}`);
                        isScriptBlock = true;
                    }
                    continue;
                }

                // 13. Filter out commands (lines starting with [)
                if (line.startsWith('[')) {
                    continue;
                }

                // 14. Keep narration/other text
                // Filter out known non-story text (Noise reduction)
                if (line.includes('解锁条件') || line.includes('点此查看') || line.includes('主线剧情一览') ||
                    line.includes('关卡一览') || line.includes('温馨提示') || line.includes('注意事项') ||
                    line.includes('推荐等级') || line.includes('首次掉落') || line.includes('三星获得') ||
                    line.includes('注释与链接') || line.includes('本页可能包含') || line.includes('剧情可能无法')) {
                    continue;
                }

                // 15. Specific User Requested Filters
                if (line.includes('axia_name') || line.includes('nbs') || line.includes('title')) {
                    continue;
                }

                // 16. Final Code/Garbage Check for Narration
                const hasChinese = /[\u4e00-\u9fa5]/.test(line);
                const isPunctuation = /^[\s\.,\?!:;'"\(\)\-—…]+$/.test(line);

                if (hasChinese) {
                    // STRICT CHINESE FILTER:
                    // Must be dialogue (contains :) OR end with punctuation OR start with quote/bracket
                    // This filters out "Activity Titles" like "异卵同生" which have no punctuation.
                    const isDialogue = line.includes(' : ') || line.includes('：');
                    const endsWithPunctuation = /[。？！…—♪\.~”"]$/.test(line);
                    const startsWithQuote = /^[“‘（【]/.test(line);

                    if (!isDialogue && !endsWithPunctuation && !startsWithQuote) {
                        continue;
                    }
                } else if (!isPunctuation) {
                    // If no Chinese and not pure punctuation, it must be English text.
                    // Filter out code-like symbols.
                    if (line.includes('(') || line.includes(')') || line.includes('_') || line.includes('/') ||
                        line.includes('{') || line.includes('}') || line.includes('[')) {
                        continue;
                    }
                    // Filter out "key: value" lines that missed the regex
                    if (line.includes(':')) {
                        continue;
                    }
                }

                // If we haven't found a definite script marker yet, be very skeptical
                if (!isScriptBlock) {
                    continue;
                }

                parsedLines.push(line);
            }

            if (parsedLines.length > 0) {
                return `\n--- ${titlePrefix} ---\n\n` + parsedLines.join('\n') + '\n';
            }
            return '';

        } catch (err) {
            // 404 is expected for some BEG/END pages if they don't exist
            if (err.response && err.response.status === 404) return '';
            // console.error(`    抓取失败 (${url}): ${err.message}`);
            return '';
        }
    };

    // Helper to get canonical title from a page
    const getCanonicalTitle = async (url) => {
        try {
            const res = await axios.get(url);
            const $ = cheerio.load(res.data);
            // Extract title from <title> tag: "Page Title - PRTS..."
            let pageTitle = $('title').text().split(' - PRTS')[0].trim();
            return pageTitle;
        } catch (e) {
            console.error(`    无法获取页面标题 (${url}): ${e.message}`);
            return null;
        }
    };

    try {
        let storyLinks = [];
        let activityPageUrl = null;

        // 1. Try to find activity page URL from main page
        console.log(`正在获取主页面...`);
        try {
            const { data } = await axios.get(MAIN_PAGE_URL);
            const $ = cheerio.load(data);
            $('a').each((i, el) => {
                const text = $(el).text().trim();
                const href = $(el).attr('href');
                if (text.includes(activityName) && (href.includes('/w/') || href.includes('prts.wiki'))) {
                    activityPageUrl = getFullUrl(href);
                }
            });
        } catch (e) {
            console.error("主页面获取失败:", e.message);
        }

        // 2. Fallback to direct URL construction
        if (!activityPageUrl) {
            activityPageUrl = `${BASE_URL}/w/${encodeURIComponent(activityName)}`;
            console.log(`未找到链接，尝试直接访问: ${activityPageUrl}`);
        } else {
            console.log(`找到活动页面: ${activityPageUrl}`);
        }

        // 3. Fetch activity page and find links
        try {
            const actRes = await axios.get(activityPageUrl);
            const $act = cheerio.load(actRes.data);

            $act('a').each((i, el) => {
                const text = $act(el).text().trim();
                const href = $act(el).attr('href');
                if (!href) return;

                // Filter logic
                const isStoryLink = href.includes('ST') || href.includes('NBT');

                // Generalized Stage Detection:
                // 1. Matches standard stage codes like "MT-1", "HS-1", "CB-EX-1"
                // 2. Matches activity name in text
                // 3. Excludes special pages
                const isStageCode = /^[A-Z]+(?:-[A-Z]+)?-\d+/.test(text);
                const isNormalStage = isStageCode || text.includes(activityName);

                if (href.includes('Special:') || href.includes('File:') || href.includes('action=') || href.includes('Talk:')) return;

                if (isStoryLink || isNormalStage) {
                    storyLinks.push({
                        title: text,
                        url: getFullUrl(href)
                    });
                }
            });
        } catch (err) {
            console.error(`无法抓取活动页面: ${err.message}`);
            return;
        }

        // Deduplicate
        storyLinks = storyLinks.filter((v, i, a) => a.findIndex(t => t.url === v.url) === i);

        if (storyLinks.length === 0) {
            console.log('未找到相关链接。');
            return;
        }

        console.log(`找到 ${storyLinks.length} 个潜在链接。开始抓取...`);
        let fullContent = `Activity: ${activityName}\n\n`;

        for (const link of storyLinks) {
            // Filter out TR, EX, S stages
            if (link.title.includes('TR-') || link.title.includes('EX-') || link.title.includes('-S-') ||
                link.url.includes('TR-') || link.url.includes('EX-') || link.url.includes('-S-')) {
                // console.log(`跳过 (TR/EX/S): ${link.title}`);
                continue;
            }

            console.log(`处理: ${link.title} (${link.url})...`);

            // Resolve canonical title first
            const canonicalTitle = await getCanonicalTitle(link.url);
            if (!canonicalTitle) {
                console.log(`    跳过: 无法获取标题`);
                continue;
            }

            const canonicalUrl = `${BASE_URL}/w/${encodeURIComponent(canonicalTitle)}`;
            // console.log(`    Canonical URL: ${canonicalUrl}`);

            const isStoryOnly = link.url.includes('ST') || link.url.includes('/NBT');

            if (isStoryOnly) {
                // Try canonical URL first (for cases where ST page IS the story page)
                let content = await extractStoryContent(canonicalUrl, canonicalTitle);
                if (!content) {
                    // Try /NBT on canonical URL
                    // console.log(`    尝试跳转 /NBT...`);
                    content = await extractStoryContent(canonicalUrl + '/NBT', canonicalTitle);
                }
                if (content) fullContent += content;
            } else {
                // Normal stage: Try BEG and END on canonical URL
                if (/[A-Z]+-\d+/.test(link.title) || link.url.match(/[A-Z]+-\d+/)) {
                    // console.log(`    检查行动前/后剧情...`);
                    const begContent = await extractStoryContent(canonicalUrl + '/BEG', `${canonicalTitle} (行动前)`);
                    if (begContent) fullContent += begContent;

                    const endContent = await extractStoryContent(canonicalUrl + '/END', `${canonicalTitle} (行动后)`);
                    if (endContent) fullContent += endContent;
                }
            }

            await new Promise(r => setTimeout(r, 200));
        }

        const filename = `${activityName}.txt`;
        fs.writeFileSync(filename, fullContent);
        console.log(`完成！已保存至 ${filename}`);

    } catch (e) {
        console.error(e);
    }
}

main();
