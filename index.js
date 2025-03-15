const express = require("express");
const fs = require("fs");
const path = require("path");
const fluentFfmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");
const ytDlp = require("yt-dlp-exec");
const puppeteer = require("puppeteer-core");
const chromium = require("chrome-aws-lambda");

fluentFfmpeg.setFfmpegPath(ffmpegPath);

const app = express();
app.use(express.json());

const OUTPUT_DIR = path.join(__dirname, "downloads");
const COOKIES_PATH = path.join(__dirname, "cookies.txt");

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR);
}

// تنظيف الملفات القديمة كل 5 دقائق
const clearOldFiles = async () => {
  const now = Date.now();
  const fiveMinutes = 5 * 60 * 1000;
  try {
    const files = await fs.promises.readdir(OUTPUT_DIR);
    await Promise.all(
      files.map(async (file) => {
        const filePath = path.join(OUTPUT_DIR, file);
        const stats = await fs.promises.stat(filePath);
        if (now - stats.mtimeMs > fiveMinutes) {
          await fs.promises.unlink(filePath);
          console.log(`Deleted old file: ${filePath}`);
        }
      })
    );
  } catch (err) {
    console.error("Error clearing old files:", err);
  }
};

setInterval(clearOldFiles, 5 * 60 * 1000);

// وظيفة استخراج رابط الفيديو من صفحات الويب
async function extractVideoFromPage(url) {
  let browser;
  try {
    browser = await puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath,
      headless: chromium.headless,
    });

    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "networkidle2" });

    // البحث عن الفيديو في الصفحة
    const videoSrc = await page.evaluate(() => {
      const video = document.querySelector("video");
      return video ? video.src : null;
    });

    if (!videoSrc) {
      throw new Error("لم يتم العثور على فيديو في الصفحة.");
    }

    return videoSrc;
  } catch (error) {
    console.error("Error extracting video from page:", error);
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// API لتحميل الفيديو
app.get("/api/getVideo", async (req, res) => {
  let videoUrl = req.query.url;

  if (!videoUrl) {
    return res.status(400).json({ error: "No video URL provided." });
  }

  try {
    const sanitizedTitle = `video_${Date.now()}`;
    const outputPath = path.join(OUTPUT_DIR, `${sanitizedTitle}.mp4`);

    // إذا كان الرابط لصفحة ويب، حاول استخراج رابط الفيديو أولاً
    if (!videoUrl.match(/\.(mp4|m3u8|mov|webm)$/i)) {
      try {
        videoUrl = await extractVideoFromPage(videoUrl);
      } catch (err) {
        return res.status(400).json({ error: "لا يمكن استخراج الفيديو من الصفحة." });
      }
    }

    // تحديد نوع المنصة
    const isSocialMedia = ["tiktok.com", "facebook.com", "fb.watch", "instagram.com", "twitter.com", "x.com"]
      .some(domain => videoUrl.includes(domain));

    if (isSocialMedia) {
      await ytDlp.exec(videoUrl, { output: outputPath, cookies: COOKIES_PATH });
    } else {
      // تحميل الفيديو والصوت بشكل منفصل إذا لم يكن من منصات التواصل
      const videoPath = path.join(OUTPUT_DIR, `${sanitizedTitle}_video.mp4`);
      const audioPath = path.join(OUTPUT_DIR, `${sanitizedTitle}_audio.mp4`);

      await Promise.all([
        ytDlp.exec(videoUrl, { format: "bestvideo[height<=720]", output: videoPath, cookies: COOKIES_PATH }),
        ytDlp.exec(videoUrl, { format: "bestaudio", output: audioPath, cookies: COOKIES_PATH }),
      ]);

      // دمج الفيديو والصوت
      await new Promise((resolve, reject) => {
        fluentFfmpeg()
          .input(videoPath)
          .input(audioPath)
          .audioCodec("aac")
          .videoCodec("copy")
          .output(outputPath)
          .on("end", resolve)
          .on("error", reject)
          .run();
      });

      // حذف الملفات المؤقتة
      fs.unlinkSync(videoPath);
      fs.unlinkSync(audioPath);
    }

    // توليد رابط التحميل
    const downloadUrl = `${req.protocol}://${req.get("host")}/downloads/${path.basename(outputPath)}`;

    res.status(200).json({
      status: true,
      creator: "AURTHER~آرثر",
      process: Math.random().toFixed(4),
      data: {
        title: sanitizedTitle,
        media: {
          type: "video",
          download: {
            url: downloadUrl,
            format: "mp4",
            quality: isSocialMedia ? "best" : "720p",
          },
        },
      },
    });
  } catch (error) {
    console.error("Error processing video:", error);
    res.status(500).json({ error: "Something went wrong: " + error.message });
  }
});

// تقديم الملفات للتحميل
app.use("/downloads", express.static(OUTPUT_DIR, {
  setHeaders: (res, filePath) => {
    res.setHeader("Content-Disposition", `attachment; filename="${path.basename(filePath)}"`);
  },
}));

// فحص الصحة
app.get("/", (req, res) => {
  res.send("آرثر هنا كل شيء يعمل بخير!");
});

// تشغيل السيرفر
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
