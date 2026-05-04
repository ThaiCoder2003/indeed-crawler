import axios, { all } from 'axios';
import XLSX from 'xlsx';
import * as cheerio from 'cheerio';
import fs from 'fs';
import FormData from 'form-data';
import { createRequire } from 'module';

const appScript = "https://script.google.com/macros/s/AKfycby286r1b4pv6nptY1CCD1JShabaXJPLe1LbKzCj8eEZVbIL4jo_5DkqCyZ8VF_iKB46/exec";
const require = createRequire(import.meta.url);
let existingKeys = new Set();

const KEYWORDS = ["Analyst", "CFA", "CEO", "Data Science", "FP&A"];

// --- HÀM UPLOAD LITTERBOX, TEAMS, TELEGRAM giữ nguyên như cũ ---
async function uploadToCatbox(filePath) {
    try {
        const form = new FormData();
        form.append('reqtype', 'fileupload');
        form.append('time', '24h');
        form.append('fileToUpload', fs.createReadStream(filePath));

        const response = await axios.post('https://litterbox.catbox.moe/resources/internals/api.php', form, {
            headers: form.getHeaders()
        });

        const fileLink = response.data.trim();
        if (fileLink.includes('https://')) return fileLink;
        throw new Error("Invalid link: " + fileLink);
    } catch (error) {
        console.error("❌ Lỗi Catbox:", error.message);
        return `https://github.com/${process.env.GITHUB_REPOSITORY}/actions`;
    }
}

async function sendToTeams(totalJobs, fileLink) {
    const webhookUrl = process.env.WEBHOOK_TEAMS;
    if (!webhookUrl) return;

    const adaptiveCard = {
        "type": "AdaptiveCard",
        "version": "1.4",
        "body": [
            { "type": "TextBlock", "text": "🚀 CẬP NHẬT JOB MỚI TẠI CALIFORNIA", "weight": "Bolder", "size": "Medium", "color": "Accent" },
            {
                "type": "FactSet",
                "facts": [
                    { "title": "Nguồn:", "value": "Indeed United States" },
                    { "title": "Số lượng:", "value": `${totalJobs} jobs` },
                    { "title": "Trạng thái:", "value": "Đã sẵn sàng ✅" }
                ]
            }
        ],
        "actions": [
            { "type": "Action.OpenUrl", "title": "📥 TẢI FILE EXCEL VỀ MÁY", "url": fileLink }
        ],
        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json"
    };

    try {
        await axios.post(webhookUrl, adaptiveCard);
        console.log("✅ [Teams] Đã gửi Card thành công!");
    } catch (error) {
        console.error("❌ [Teams] Lỗi gửi:", error.message);
    }
}

async function sendToGoogleSheets(jobs, query) {
  const sheetName = (query || "Indeed Crawl")
    .replace(/[\/\\\?\*\[\]]/g, "")
    .substring(0, 100);
  
  const payload = {
    sheetName,
    jobs
  };

    try {
        const response = await axios.post(appScript, payload, {
            headers: { "Content-Type": "application/json" }
        });

        if (response.data && response.data.success) {
            console.log("✅ Đã gửi dữ liệu lên Google Sheets thành công!");
        }

        else {
            console.error("❌ Lỗi từ Google Sheets:", response.data.error || "Unknown error");
        }
    } catch (error) {
        console.error("❌ Lỗi gửi lên Google Sheets:", error.message);
    }
}

// --- HÀM CHẠY CHÍNH ---
async function runScraper() {
    console.log("🚀 Khởi động Scraper...");
    let allJobs = [];

    for (const kw of KEYWORDS) {
        const targetUrl = `https://www.indeed.com/jobs?q=${encodeURIComponent(kw + ' $60,000')}&l=California&radius=25&fromage=3`;
        let attempts = 0;
        const maxAttempts = 3;

        let newJobsForThisKw = [];

        while (attempts < maxAttempts) {
            try {
                attempts++;
                console.log(`🔍 Quét: ${kw} (Lần ${attempts})...`);

                const response = await axios.get('http://api.scraperapi.com', {
                    params: {
                        api_key: process.env.SCRAPER_API_KEY,
                        url: targetUrl,
                        country_code: 'us'
                    },
                    timeout: 60000
                });

                const $ = cheerio.load(response.data);
                let count = 0;

                $('.job_seen_beacon').each((i, el) => {
                    const titleEl = $(el).find('h2.jobTitle, a.jcs-JobTitle');

                    const title = titleEl.text().trim();

                    if (!title) return;

                    const jk = $(el).find('[data-jk]').first().attr('data-jk') || 
                            titleEl.attr('data-jk') || 
                            titleEl.attr('href')?.match(/jk=([^&]+)/)?.[1];

                    if (!jk) {
                        console.log("⚠️ Missing jk:", title);
                        return;
                    }

                    if (existingKeys.has(jk)) {
                        console.log(`⏭️ Bỏ qua job đã tồn tại: ${title}`);
                        return;
                    }

                    const relativeLink = jk ? `https://www.indeed.com/viewjob?jk=${jk}` : (titleEl.find('a').attr('href') || titleEl.attr('href'));

                    // ==================== LẤY SALARY - CHỈ GIỮ PHẦN SỐ TIỀN ====================
                    let salary = "";

                    let salaryEl = $(el).find('[data-testid="attribute_snippet_testid"], .salary-snippet-container, .estimated-salary, [class*="salary-snippet"], .salary-section');

                    if (salaryEl.length) {
                        salary = salaryEl.text().trim();
                    }

                    salary = salary.replace(/\s+/g, ' ').trim();

                    // Chỉ giữ nếu có dấu $
                    const match = salary.match(/\$[\d,.]+k?(?:\+)?(?:\s*-\s*\$[\d,.]+k?)?(?:\s*(?:\/|per)?\s*(?:year|yr|hour|hr|week|mo))?/i);
                    salary = match ? match[0] : "";
                    // =================================================================

                    const location = $(el).find('[data-testid="text-location"]').text().trim() ||
                                     $(el).find('.companyLocation').text().trim() ||
                                     "California, BC";

                    const company = $(el).find('[data-testid="company-name"]').text().trim() || "N/A";

                    const isQuickApply = $(el).find('.iaIcon').length > 0;
                    const applyMethod = isQuickApply ? "Indeed Quick Apply" : "Company Website";

                    const job = {
                        key: jk,
                        title: title,
                        company: company,
                        salary: salary,
                        location: location,
                        apply_method: applyMethod,
                        link: relativeLink ? relativeLink : 'N/A',
                        keyword: kw
                    };

                    newJobsForThisKw.push(job);
                    existingKeys.add(jk);
                    count++;
                });

                console.log(`✅ Lấy được ${count} jobs cho từ khóa "${kw}"`);
                if (count > 0) break;

            } catch (err) {
                console.log(`⚠️ Lỗi ${kw} (lần ${attempts}): ${err.message}`);
                if (attempts < maxAttempts) await new Promise(r => setTimeout(r, 5000));
            }
        }

        if (newJobsForThisKw.length > 0) {
            console.log(`✅ Từ khóa "${kw}" có ${newJobsForThisKw.length} job mới.`);
            allJobs = allJobs.concat(newJobsForThisKw);
        }
    }

    if (allJobs.length > 0) {
        allJobs.sort((a, b) => {
            if (a.salary && !b.salary) return -1;
            if (!a.salary && b.salary) return 1;
            return a.company.localeCompare(b.company);
        });

        const fileName = `Indeed_Jobs_${new Date().toISOString().slice(0,10)}.xlsx`;
        const workbook = XLSX.utils.book_new();
        const orderedData = allJobs.map(job => ({
            Title: job.title,
            Company: job.company,
            Location: job.location,
            Salary: job.salary,
            "Apply Method": job.apply_method,
            Keyword: job.keyword,
            Link: { f: `HYPERLINK("${job.link}", "Apply")` }
        }));
        KEYWORDS.forEach(kw => {
            const jobsForKw = orderedData.filter(j => j.Keyword === kw);
            if (jobsForKw.length === 0) return;
            const worksheet = XLSX.utils.json_to_sheet(jobsForKw);

            worksheet['!cols'] = [
                { wch: 40 }, // Title
                { wch: 25 }, // Company
                { wch: 20 }, // Location
                { wch: 15 }, // Salary
                { wch: 20 }, // Apply Method
                { wch: 20 }, // Keyword
                { wch: 15 }  // Link
            ];
            worksheet['!freeze'] = { ySplit: 1 };
            worksheet['!autofilter'] = {
                ref: "A1:G1"
            };

            XLSX.utils.book_append_sheet(workbook, worksheet, kw);
        });

        const summaryData = [
            ["Indeed Job Report"],
            [""],
            ["Date", new Date().toLocaleString()],
            ["Total Jobs", allJobs.length],
            ["Keywords", KEYWORDS.join(", ")],
            ["Location", "California, USA"]
        ];

        const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
        XLSX.utils.book_append_sheet(workbook, summarySheet, "Summary");
        XLSX.writeFile(workbook, fileName);

        console.log(`📊 Đã lưu ${allJobs.length} jobs vào ${fileName}`);

        // const fileLink = await uploadToCatbox(fileName);

        await Promise.all([
            // sendToTeams(allJobs.length, fileLink),
            sendToGoogleSheets(allJobs, "")
        ]);

        console.log("🏁 Hoàn tất!");
    } else {
        console.log("❌ Không tìm thấy job nào.");
    }
}

runScraper();