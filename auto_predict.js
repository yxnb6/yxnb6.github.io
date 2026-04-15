const https = require('https');

const GIST_ID = 'ff10b9019cf3d0cab558ff802e320361';
const GIST_TOKEN = process.env.GIST_TOKEN;
const FILENAME = 'pc28_predictions.json';

const combos = ['大单','大双','小单','小双'];

function fetchData() {
    return new Promise((resolve, reject) => {
        https.get('https://pc28.ai/api/kj.json?nbr=50', (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch(e) {
                    reject(e);
                }
            });
        }).on('error', reject);
    });
}

function predict(history) {
    const seq = history.map(d => {
        const s = parseInt(d.num);
        return (s > 13 ? '大' : '小') + (s % 2 === 0 ? '双' : '单');
    });
    const sums = history.map(d => parseInt(d.num));
    
    const freq = {大单:0,大双:0,小单:0,小双:0};
    seq.slice(0, 15).forEach((c, i) => freq[c] += Math.pow(0.85, i));
    
    const total = Object.values(freq).reduce((a,b)=>a+b,0);
    const probs = {};
    combos.forEach(c => probs[c] = freq[c] / total);
    
    const sorted = Object.entries(probs).sort((a,b)=>b[1]-a[1]);
    
    const avg = sums.slice(0, 10).reduce((a,b)=>a+b,0) / 10;
    const predSum = Math.round(13.5 + (sums[0] - avg) * 0.5);
    
    const recent = seq.slice(0, 12);
    let changes = 0;
    for(let i=1;i<recent.length;i++) if(recent[i]!==recent[i-1]) changes++;
    const changeRate = changes / (recent.length - 1);
    let trend = '优';
    if(changeRate > 0.7) trend = '差';
    else if(changeRate > 0.5) trend = '良';
    
    return {
        period: history[0].nbr,
        time: new Date().toLocaleString('zh-CN', {timeZone: 'Asia/Shanghai'}),
        single: sorted[0][0],
        double: [sorted[0][0], sorted[1][0]],
        sumPredict: predSum,
        trend: trend,
        probs: probs
    };
}

function readGist() {
    return new Promise((resolve) => {
        https.get({
            hostname: 'api.github.com',
            path: `/gists/${GIST_ID}`,
            headers: {
                'Authorization': `Bearer ${GIST_TOKEN}`,
                'User-Agent': 'PC28-Auto',
                'Accept': 'application/vnd.github.v3+json'
            }
        }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try {
                    const gist = JSON.parse(data);
                    const file = gist.files[FILENAME];
                    resolve(file ? JSON.parse(file.content) : { predictions: [] });
                } catch(e) {
                    resolve({ predictions: [] });
                }
            });
        }).on('error', () => resolve({ predictions: [] }));
    });
}

function updateGist(data) {
    const content = JSON.stringify(data, null, 2);
    return new Promise((resolve, reject) => {
        const req = https.request({
            method: 'PATCH',
            hostname: 'api.github.com',
            path: `/gists/${GIST_ID}`,
            headers: {
                'Authorization': `Bearer ${GIST_TOKEN}`,
                'Content-Type': 'application/json',
                'User-Agent': 'PC28-Auto'
            }
        }, (res) => {
            if(res.statusCode >= 200 && res.statusCode < 300) {
                resolve();
            } else {
                reject(new Error(`HTTP ${res.statusCode}`));
            }
        });
        req.on('error', reject);
        req.write(JSON.stringify({ files: { [FILENAME]: { content } } }));
        req.end();
    });
}

async function main() {
    console.log('开始运行...');
    try {
        const kjData = await fetchData();
        const latest = kjData.data[0];
        console.log(`期号: ${latest.nbr}`);
        
        const cloudData = await readGist();
        const lastPred = cloudData.predictions ? cloudData.predictions[0] : null;
        
        if (lastPred && lastPred.period === latest.nbr) {
            console.log('本期已预测，跳过');
            return;
        }
        
        const prediction = predict(kjData.data);
        console.log(`预测: ${prediction.single}`);
        
        if (!cloudData.predictions) cloudData.predictions = [];
        cloudData.predictions.unshift(prediction);
        if (cloudData.predictions.length > 100) cloudData.predictions = cloudData.predictions.slice(0, 100);
        cloudData.lastUpdate = new Date().toISOString();
        
        await updateGist(cloudData);
        console.log('完成！');
    } catch(e) {
        console.error('错误:', e.message);
        process.exit(1);
    }
}

main();
