const express = require("express");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const fluentFfmpeg = require("fluent-ffmpeg");

// استيراد المسارات الثابتة للمشغلات
const ffmpegPath = require("ffmpeg-static");
const ffprobePath = require("ffprobe-static").path;

// إعداد fluent-ffmpeg ليعرف مكان الأدوات
fluentFfmpeg.setFfmpegPath(ffmpegPath);
fluentFfmpeg.setFfprobePath(ffprobePath);

const app = express();
app.use(express.json());

/* ================== الإعدادات ================== */
const OUTPUT_DIR = path.join(__dirname, "downloads");
const COOKIES_PATH = path.join(__dirname, "cookies.txt");
const YTDLP_PATH = process.env.YTDLP_PATH || "yt-dlp";

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR);
}

/* ================== وظيفة الضغط الذكي ================== */
const compressToTargetSize = (inputPath, targetSizeMB = 7.7) => {
  return new Promise((resolve, reject) => {
    const outputPath = path.join(OUTPUT_DIR, `compressed_${Date.now()}.mp4`);

    // فحص مدة الفيديو للحصول على البت ريت المناسب
    fluentFfmpeg.ffprobe(inputPath, (err, metadata) => {
      if (err) return reject(new Error("FFprobe failed: " + err.message));

      const duration = metadata.format.duration; 
      const targetSizeBits = targetSizeMB * 1024 * 1024 * 8;
      let totalBitrate = Math.floor(targetSizeBits / duration);
      
      // تخصيص بت ريت للصوت والفيديو
      let audioBitrate = 128000; 
      let videoBitrate = totalBitrate - audioBitrate;

      // ضمان جودة دنيا مقبولة
      if (videoBitrate < 150000) videoBitrate = 150000;

      fluentFfmpeg(inputPath)
        .outputOptions([
          `-b:v ${videoBitrate}`,
          `-maxrate ${videoBitrate}`,
          `-bufsize ${videoBitrate * 2}`,
          "-preset fast",
          "-c:v libx264"
        ])
        .audioBitrate(128)
        .save(outputPath)
        .on("end", () => resolve(outputPath))
        .on("error", (err) => reject(new Error("Compression Error: " + err.message)));
    });
  });
};

/* ================== تنظيف الملفات (كل 5 دقائق) ================== */
const clearOldFiles = async () => {
  const now = Date.now();
  const maxAge = 5 * 60 * 1000;
  try {
    const files = await fs.promises.readdir(OUTPUT_DIR);
    for (const file of files) {
      const filePath = path.join(OUTPUT_DIR, file);
      const stats = await fs.promises.stat(filePath);
      if (now - stats.mtimeMs > maxAge) {
        await fs.promises.unlink(filePath);
      }
    }
  } catch (err) { console.error("Cleanup error:", err); }
};
setInterval(clearOldFiles, 5 * 60 * 1000);

/* ================== تشغيل yt-dlp ================== */
const runYtDlp = (args) =>
  new Promise((resolve, reject) => {
    execFile(YTDLP_PATH, args, { maxBuffer: 1024 * 1024 * 10 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout);
    });
  });

/* ================== API ================== */
app.get("/api/getVideo", async (req, res) => {
  const videoUrl = req.query.url;
  const requestedRes = req.query.res || "720"; 

  if (!videoUrl) return res.status(400).json({ error: "No URL provided" });

  try {
    const title = `video_${Date.now()}`;
    let finalPath = path.join(OUTPUT_DIR, `${title}.mp4`);

    // تحديد نوع المنصة
    const isSpecial = /tiktok|instagram|facebook|twitter|x\.com/.test(videoUrl);

    if (isSpecial) {
      await runYtDlp([
        videoUrl,
        "-f", `best[height<=${requestedRes}]/best`,
        "-o", finalPath,
        "--merge-output-format", "mp4",
        "--cookies", COOKIES_PATH,
        "--no-playlist"
      ]);
    } else {
      // YouTube Logic
      const vPath = path.join(OUTPUT_DIR, `${title}_v.mp4`);
      const aPath = path.join(OUTPUT_DIR, `${title}_a.m4a`);

      await Promise.all([
        runYtDlp([videoUrl, "-f", `bestvideo[height<=${requestedRes}]`, "-o", vPath, "--cookies", COOKIES_PATH]),
        runYtDlp([videoUrl, "-f", "bestaudio", "-o", aPath, "--cookies", COOKIES_PATH])
      ]);

      await new Promise((res, rej) => {
        fluentFfmpeg().input(vPath).input(aPath).videoCodec("copy").audioCodec("aac").output(finalPath).on("end", res).on("error", rej).run();
      });
      if (fs.existsSync(vPath)) fs.unlinkSync(vPath);
      if (fs.existsSync(aPath)) fs.unlinkSync(aPath);
    }

    // فحص الحجم والضغط إذا لزم الأمر
    let stats = fs.statSync(finalPath);
    let fileSizeMB = stats.size / (1024 * 1024);

    if (fileSizeMB > 8) {
      console.log(`File is ${fileSizeMB.toFixed(2)}MB. Compressing...`);
      try {
        const compressedPath = await compressToTargetSize(finalPath);
        fs.unlinkSync(finalPath); // حذف الأصلي الكبير
        finalPath = compressedPath;
        fileSizeMB = fs.statSync(finalPath).size / (1024 * 1024);
      } catch (e) { console.error("Compression failed:", e.message); }
    }

    const downloadUrl = `${req.protocol}://${req.get("host")}/downloads/${path.basename(finalPath)}`;

    res.json({
      status: true,
      creator: "AURTHER~آرثر",
      data: {
        title,
        size: fileSizeMB.toFixed(2) + " MB",
        download_url: downloadUrl
      }
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.use("/downloads", express.static(OUTPUT_DIR));
app.get("/", (req, res) => res.send("آرثر يعمل ✅"));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server on port ${port}`));
