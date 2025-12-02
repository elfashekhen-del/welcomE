const express = require('express');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(cors());
app.use(express.static('public'));

// مجلد البوتات
const botsDir = path.join(__dirname, 'bots');
if (!fs.existsSync(botsDir)) {
    fs.mkdirSync(botsDir);
}

// تخزين البوتات النشطة
const activeBots = {};
const botLogs = {};

// استضافة بوت جديد
app.post('/api/host-bot', async (req, res) => {
    try {
        const { name, code, botId } = req.body;
        
        console.log(`🔧 جاري استضافة بوت جديد: ${name}`);
        
        // حفظ الكود في ملف
        const botFile = path.join(botsDir, `${botId}.js`);
        fs.writeFileSync(botFile, code);
        
        // إنشاء package.json للبوت
        const packageJson = {
            name: `discord-bot-${botId}`,
            version: "1.0.0",
            main: `${botId}.js`,
            dependencies: {
                "discord.js": "^14.0.0"
            }
        };
        
        fs.writeFileSync(path.join(botsDir, `package-${botId}.json`), JSON.stringify(packageJson, null, 2));
        
        // تشغيل البوت
        const botProcess = spawn('node', [botFile], {
            cwd: botsDir,
            stdio: ['pipe', 'pipe', 'pipe']
        });
        
        activeBots[botId] = {
            process: botProcess,
            name: name,
            status: 'starting',
            code: code,
            createdAt: new Date().toISOString()
        };
        
        botLogs[botId] = [];
        
        // جمع logs
        botProcess.stdout.on('data', (data) => {
            const log = `[INFO] ${data.toString().trim()}`;
            botLogs[botId].push(log);
            console.log(`[${botId}] ${log}`);
        });
        
        botProcess.stderr.on('data', (data) => {
            const log = `[ERROR] ${data.toString().trim()}`;
            botLogs[botId].push(log);
            console.error(`[${botId}] ${log}`);
        });
        
        botProcess.on('close', (code) => {
            activeBots[botId].status = 'offline';
            botLogs[botId].push(`[SYSTEM] البوت توقف مع الكود: ${code}`);
        });
        
        // تحديث الحالة بعد ثانيتين
        setTimeout(() => {
            if (botProcess.exitCode === null) {
                activeBots[botId].status = 'online';
            }
        }, 2000);
        
        res.json({ 
            success: true, 
            message: 'تم استضافة البوت بنجاح',
            botId: botId
        });
        
    } catch (error) {
        console.error('❌ خطأ في استضافة البوت:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// إيقاف البوت
app.post('/api/stop-bot', (req, res) => {
    const { botId } = req.body;
    
    if (activeBots[botId]) {
        try {
            activeBots[botId].process.kill();
            activeBots[botId].status = 'offline';
            botLogs[botId].push('[SYSTEM] تم إيقاف البوت');
            
            res.json({ 
                success: true, 
                message: 'تم إيقاف البوت' 
            });
        } catch (error) {
            res.status(500).json({ 
                success: false, 
                error: error.message 
            });
        }
    } else {
        res.status(404).json({ 
            success: false, 
            error: 'البوت غير موجود' 
        });
    }
});

// إعادة تشغيل البوت
app.post('/api/restart-bot', (req, res) => {
    const { botId } = req.body;
    
    if (activeBots[botId]) {
        try {
            const bot = activeBots[botId];
            bot.process.kill();
            
            // إعادة التشغيل بعد ثانية
            setTimeout(() => {
                const newProcess = spawn('node', [`${botId}.js`], {
                    cwd: botsDir,
                    stdio: ['pipe', 'pipe', 'pipe']
                });
                
                bot.process = newProcess;
                bot.status = 'starting';
                
                // جمع logs للعملية الجديدة
                newProcess.stdout.on('data', (data) => {
                    botLogs[botId].push(`[INFO] ${data.toString().trim()}`);
                });
                
                newProcess.stderr.on('data', (data) => {
                    botLogs[botId].push(`[ERROR] ${data.toString().trim()}`);
                });
                
                newProcess.on('close', (code) => {
                    bot.status = 'offline';
                });
                
                setTimeout(() => {
                    if (newProcess.exitCode === null) {
                        bot.status = 'online';
                    }
                }, 2000);
                
            }, 1000);
            
            res.json({ 
                success: true, 
                message: 'تم إعادة تشغيل البوت' 
            });
            
        } catch (error) {
            res.status(500).json({ 
                success: false, 
                error: error.message 
            });
        }
    } else {
        res.status(404).json({ 
            success: false, 
            error: 'البوت غير موجود' 
        });
    }
});

// الحصول على حالة البوتات
app.get('/api/bots', (req, res) => {
    const botsList = Object.keys(activeBots).map(botId => {
        const bot = activeBots[botId];
        return {
            id: botId,
            name: bot.name,
            status: bot.status,
            createdAt: bot.createdAt,
            logs: botLogs[botId] || []
        };
    });
    
    res.json(botsList);
});

// الحصول على سجلات البوت
app.get('/api/bot-logs/:botId', (req, res) => {
    const { botId } = req.params;
    res.json(botLogs[botId] || []);
});

// حذف البوت
app.delete('/api/bot/:botId', (req, res) => {
    const { botId } = req.params;
    
    if (activeBots[botId]) {
        try {
            // إيقاف البوت
            activeBots[botId].process.kill();
            
            // حذف الملف
            const botFile = path.join(botsDir, `${botId}.js`);
            if (fs.existsSync(botFile)) {
                fs.unlinkSync(botFile);
            }
            
            // حذف من الذاكرة
            delete activeBots[botId];
            delete botLogs[botId];
            
            res.json({ 
                success: true, 
                message: 'تم حذف البوت' 
            });
            
        } catch (error) {
            res.status(500).json({ 
                success: false, 
                error: error.message 
            });
        }
    } else {
        res.status(404).json({ 
            success: false, 
            error: 'البوت غير موجود' 
        });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 الخادم يعمل على المنفذ ${PORT}`);
    console.log(`📁 مجلد البوتات: ${botsDir}`);
    console.log(`🌐 افتح المتصفح على: http://localhost:${PORT}`);
});