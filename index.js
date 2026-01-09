const express = require("express");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const ffmpegPath = require("ffmpeg-static");

const app = express();
app.use(express.json());

/* ================== الإعدادات ================== */
const OUTPUT_DIR = path.join(__dirname, "downloads");
const COOKIES_PATH = path.join(__dirname, "cookies.txt");
const YTDLP_PATH = process.env.YTDLP_PATH || "yt-dlp";

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR);
}

/* ================== تنظيف الملفات تلقائياً ================== */
const clearOldFiles = async () => {
  const now = Date.now();
  const maxAge = 5 * 60 * 1000; 
  try {
    const files = await fs.promises.readdir(OUTPUT_DIR);
    await Promise.all(
      files.map(async (file) => {
        const filePath = path.join(OUTPUT_DIR, file);
        const stats = await fs.promises.stat(filePath);
        if (now - stats.mtimeMs > maxAge) {
          await fs.promises.unlink(filePath);
        }
      })
    );
  } catch (err) {
    console.error("Cleanup error:", err);
  }
};
setInterval(clearOldFiles, 5 * 60 * 1000);

/* ================== دالة تشغيل yt-dlp ================== */
const runYtDlp = (args) =>
  new Promise((resolve, reject) => {
    // زيادة حجم الذاكرة المؤقتة لتجنب الأخطاء مع الروابط الطويلة
    execFile(YTDLP_PATH, args, { maxBuffer: 1024 * 1024 * 10 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr || err.message));
      } else {
        resolve(stdout);
      }
    });
  });

/* ================== API التحميل الموحد ================== */
app.get("/api/getVideo", async (req, res) => {
  const videoUrl = req.query.url;
  const requestedRes = req.query.res || "720"; 

  if (!videoUrl) {
    return res.status(400).json({ error: "No video URL provided" });
  }

  try {
    const fileName = `video_${Date.now()}.mp4`;
    const outputPath = path.join(OUTPUT_DIR, fileName);

    // أمر التحميل الموحد لجميع المنصات
    // يقوم باختيار أفضل فيديو (أقل من أو يساوي الجودة المطلوبة) + أفضل صوت ودمجهم تلقائياً
    const ytDlpArgs = [
      videoUrl,
      "-f", `bestvideo[height<=${requestedRes}][ext=mp4]+bestaudio[ext=m4a]/best[height<=${requestedRes}]/best`,
      "--merge-output-format", "mp4",
      "--ffmpeg-location", ffmpegPath, // إخبار yt-dlp بمكان ffmpeg للدمج
      "-o", outputPath,
      "--cookies", COOKIES_PATH,
      "--no-playlist",
      "--format-sort", `res:${requestedRes},vcodec:h264`, // تفضيل h264 للتوافقية
    ];

    await runYtDlp(ytDlpArgs);

    const downloadUrl = `${req.protocol}://${req.get("host")}/downloads/${fileName}`;

    res.json({
      status: true,
      creator: "AURTHER~آرثر",
      data: {
        title: `video_${Date.now()}`,
        media: {
          type: "video",
          download: {
            url: downloadUrl,
            format: "mp4",
            requested_resolution: requestedRes,
          },
        },
      },
    });
  } catch (err) {
    console.error("Error details:", err.message);
    res.status(500).json({ 
      error: "فشل في معالجة الفيديو.", 
      details: err.message.includes("403") ? "تم حظر الوصول (قد تحتاج لتحديث ملف الكوكيز)" : "تأكد من الرابط"
    });
  }
});

/* ================== تشغيل السيرفر ================== */
app.get("/", (req, res) => res.send("آرثر هنا — الأنظمة تعمل لجميع المنصات بنفس الكفاءة 🚀"));
app.use("/downloads", express.static(OUTPUT_DIR));

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
