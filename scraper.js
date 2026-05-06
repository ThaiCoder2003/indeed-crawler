import axios, { all } from 'axios';
import XLSX from 'xlsx';
import * as cheerio from 'cheerio';
import fs from 'fs';
import FormData from 'form-data';
import { createRequire } from 'module';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const Catbox = require('node-catbox');
const catbox = new Catbox();

const appScript = "https://script.google.com/macros/s/AKfycbwZyM19-hv2Z9Fz1z4lgnaOftjC4mDsCQrsD9IxTI3ChnjUBmoReELMOhQ8dIqsOHiY/exec";
const require = createRequire(import.meta.url);
let existingKeys = new Set();

const KEYWORDS = ["Backend Developer"];

function parseSalary(s) {
    if (!s) return 0;

    const match = s.match(/\$([\d,.]+)/);
    if (!match) return 0;

    return parseFloat(match[1].replace(/,/g, ""));
}

async function sendToGoogleSheets(jobs) {  
    const payload = {
        jobs,
    };

    try {
        const response = await axios.post(appScript, payload, {
            headers: { "Content-Type": "application/json" }
        });

        if (response.data && response.data.status === "success") {
            console.log("✅ Đã gửi dữ liệu lên Google Sheets thành công!");
        }

        else {
            console.error("❌ Lỗi từ Google Sheets:", response.data.message || "Unknown error");
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
        const targetUrl = `https://www.indeed.com/jobs?q=${encodeURIComponent(kw)}&l=California&radius=25&fromage=3`;
        let attempts = 0;
        const maxAttempts = 2;

        let newJobsForThisKw = [];

        while (attempts < maxAttempts) {
            try {
                attempts++;
                console.log(`🔍 Quét: ${kw} (Lần ${attempts})...`);

                const response = await axios.get('http://api.scraperapi.com', {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                        'Accept-Language': 'en-US,en;q=0.9'
                    },
                    params: {
                        api_key: process.env.SCRAPER_API_KEY,
                        url: targetUrl,
                        country_code: 'us'
                    },
                    timeout: 60000
                });

                if (!response.data.includes("job_seen_beacon")) {
                    console.log("🚫 Blocked or invalid page");
                    break;
                }

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


                    const salaryEl = $(el).find('[data-testid="attribute_snippet_testid"], .salary-snippet-container, .estimated-salary, [class*="salary-snippet"], .salary-section');

                    if (salaryEl.length) {
                        const text = salaryEl.first().text().trim();
                        const match = text.match(
                            /\$[\d,.]+k?(?:\+)?(?:\s*[–-]\s*\$[\d,.]+k?)?(?:\s*(?:\/|per)?\s*(?:year|yr|hour|hr|week|mo))?/i
                        );
                        if (match) {
                            salary = match[0].replace(/\s/g, '');
                        } else {
                            salary = text;
                        }
                    }

                    // =================================================================

                    const location = $(el).find('[data-testid="text-location"]').text().trim() ||
                                     $(el).find('.companyLocation').text().trim() ||
                                     "California, USA";

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
        const fileName = `Indeed_Jobs_${new Date().toISOString().slice(0,10)}.xlsx`;
        const workbook = XLSX.utils.book_new();
        const orderedData = allJobs.map(job => ({
            Title: job.title,
            Company: job.company,
            Location: job.location,
            Salary: job.salary,
            "Apply Method": job.apply_method,
            Keyword: job.keyword,
            Link: { f: `HYPERLINK("${job.link.replace(/"/g, '""')}", "Apply")` }
        }));
        for (const kw of KEYWORDS) {
            const jobsForKw = orderedData.filter(j => j.Keyword === kw);
            
            jobsForKw.sort((a, b) => {
                const salaryA = parseSalary(a.Salary);
                const salaryB = parseSalary(b.Salary);

                if (salaryA !== salaryB) return salaryB - salaryA; // high → low
                return a.Company.localeCompare(b.Company);
            });


            if (jobsForKw.length === 0) continue;
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

            const safeName = kw.replace(/[\\/?*[\]:]/g, "").substring(0, 31);

            XLSX.utils.book_append_sheet(workbook, worksheet, safeName);
        };

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

        await Promise.all([
            sendToGoogleSheets(allJobs)
        ]);

        console.log("🏁 Hoàn tất!");
    } else {
        console.log("❌ Không tìm thấy job nào.");
    }
}

runScraper();