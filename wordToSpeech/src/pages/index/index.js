/*
 * @Autor: lycheng
 * @Date: 2020-01-13 16:12:22
 */
/**
 * Created by iflytek on 2019/11/19.
 *
 * 在线语音合成调用demo
 * 此demo只是一个简单的调用示例，不适合用到实际生产环境中
 *
 * 在线语音合成 WebAPI 接口调用示例 接口文档（必看）：https://www.xfyun.cn/doc/tts/online_tts/API.html
 * 错误码链接：
 * https://www.xfyun.cn/doc/tts/online_tts/API.html
 * https://www.xfyun.cn/document/error-code （code返回错误码时必看）
 *
 */

// 1. websocket连接：判断浏览器是否兼容，获取websocket url并连接，这里为了方便本地生成websocket url
// 2. 连接websocket，向websocket发送数据，实时接收websocket返回数据
// 3. 处理websocket返回数据为浏览器可以播放的音频数据
// 4. 播放音频数据
// ps: 该示例用到了es6中的一些语法，建议在chrome下运行
import { downloadPCM, downloadWAV } from 'js/download.js'
import CryptoJS from 'crypto-js'
import Enc from 'enc'
import TransWorker from 'js/transcode.worker.js'
import VConsole from 'vconsole'
import { Base64 } from 'js-base64'
import './index.css'

let transWorker = new TransWorker()
// APPID，APISecret，APIKey在控制台-我的应用-语音合成（流式版）页面获取
const APPID = 'xxx'
const API_SECRET = 'xxx'
const API_KEY = 'xxx'

function getWebsocketUrl () {
  return new Promise((resolve, reject) => {
    let apiKey = API_KEY
    let apiSecret = API_SECRET
    let url = 'wss://tts-api.xfyun.cn/v2/tts'
    let { host } = location
    let date = new Date().toGMTString()
    let algorithm = 'hmac-sha256'
    let headers = 'host date request-line'
    let signatureOrigin = `host: ${host}\ndate: ${date}\nGET /v2/tts HTTP/1.1`
    let signatureSha = CryptoJS.HmacSHA256(signatureOrigin, apiSecret)
    let signature = CryptoJS.enc.Base64.stringify(signatureSha)
    let authorizationOrigin = `api_key="${apiKey}", algorithm="${algorithm}", headers="${headers}", signature="${signature}"`
    let authorization = btoa(authorizationOrigin)
    url = `${url}?authorization=${authorization}&date=${date}&host=${host}`
    resolve(url)
  })
}
class TTSRecorder {
  constructor ({
    speed = 50,
    voice = 50,
    pitch = 50,
    voiceName = 'xiaoyan',
    appId = APPID,
    text = '',
    tte = 'UTF8',
    defaultText = '请输入您要合成的文本',
  } = {}) {
    this.speed = speed
    this.voice = voice
    this.pitch = pitch
    this.voiceName = voiceName
    this.text = text
    this.tte = tte
    this.defaultText = defaultText
    this.appId = appId
    this.audioData = []
    this.rawAudioData = []
    this.audioDataOffset = 0
    this.status = 'init'
    transWorker.onmessage = (e) => {
      this.audioData.push(...e.data.data)
      this.rawAudioData.push(...e.data.rawAudioData)
    }
  }

  // 修改录音听写状态
  setStatus (status) {
    this.onWillStatusChange && this.onWillStatusChange(this.status, status)
    this.status = status
  }

  // 设置合成相关参数
  setParams ({ speed, voice, pitch, text, voiceName, tte }) {
    speed !== undefined && (this.speed = speed)
    voice !== undefined && (this.voice = voice)
    pitch !== undefined && (this.pitch = pitch)
    text && (this.text = text)
    tte && (this.tte = tte)
    voiceName && (this.voiceName = voiceName)
    this.resetAudio()
  }

  // 连接websocket
  connectWebSocket () {
    this.setStatus('ttsing')
    return getWebsocketUrl().then(url => {
      let ttsWS
      if ('WebSocket' in window) {
        ttsWS = new WebSocket(url)
      } else if ('MozWebSocket' in window) {
        ttsWS = new MozWebSocket(url)
      } else {
        alert('浏览器不支持WebSocket')
        return
      }
      this.ttsWS = ttsWS
      ttsWS.onopen = e => {
        this.webSocketSend()
        this.playTimeout = setTimeout(() => {
          this.audioPlay()
        }, 1000)
      }
      ttsWS.onmessage = e => {
        this.result(e.data)
      }
      ttsWS.onerror = e => {
        clearTimeout(this.playTimeout)
        this.setStatus('errorTTS')
        alert('WebSocket报错，请f12查看详情')
        console.error(`详情查看：${encodeURI(url.replace('wss:', 'https:'))}`)
      }
      ttsWS.onclose = e => {
        console.log(e)
      }
    })
  }

  // 处理音频数据
  transToAudioData (audioData) {}
  // websocket发送数据
  webSocketSend () {
    let params = {
      common: {
        app_id: this.appId, // APPID
      },
      business: {
        aue: 'raw',
        auf: 'audio/L16;rate=16000',
        vcn: this.voiceName,
        speed: this.speed,
        volume: this.voice,
        pitch: this.pitch,
        bgs: 0,
        tte: this.tte,
      },
      data: {
        status: 2,
        text: this.encodeText(
          this.text || this.defaultText,
          this.tte === 'unicode' ? 'base64&utf16le' : ''
        )
      },
    }
    this.ttsWS.send(JSON.stringify(params))
  }

  encodeText (text, encoding) {
    switch (encoding) {
      case 'utf16le' : {
        let buf = new ArrayBuffer(text.length * 4)
        let bufView = new Uint16Array(buf)
        for (let i = 0, strlen = text.length; i < strlen; i++) {
          bufView[i] = text.charCodeAt(i)
        }
        return buf
      }
      case 'buffer2Base64': {
        let binary = ''
        let bytes = new Uint8Array(text)
        let len = bytes.byteLength
        for (let i = 0; i < len; i++) {
          binary += String.fromCharCode(bytes[i])
        }
        return window.btoa(binary)
      }
      case 'base64&utf16le' : {
        return this.encodeText(this.encodeText(text, 'utf16le'), 'buffer2Base64')
      }
      default : {
        return Base64.encode(text)
      }
    }
  }

  // websocket接收数据的处理
  result (resultData) {
    let jsonData = JSON.parse(resultData)
    // 合成失败
    if (jsonData.code !== 0) {
      alert(`合成失败: ${jsonData.code}:${jsonData.message}`)
      console.error(`${jsonData.code}:${jsonData.message}`)
      this.resetAudio()
      return
    }
    transWorker.postMessage(jsonData.data.audio)

    if (jsonData.code === 0 && jsonData.data.status === 2) {
      this.ttsWS.close()
    }
  }

  // 重置音频数据
  resetAudio () {
    this.audioStop()
    this.setStatus('init')
    this.audioDataOffset = 0
    this.audioData = []
    this.rawAudioData = []
    this.ttsWS && this.ttsWS.close()
    clearTimeout(this.playTimeout)
  }

  // 音频初始化
  audioInit () {
    let AudioContext = window.AudioContext || window.webkitAudioContext
    if (AudioContext) {
      this.audioContext = new AudioContext()
      this.audioContext.resume()
      this.audioDataOffset = 0
    }
  }

  // 音频播放
  audioPlay () {
    this.setStatus('play')
    let audioData = this.audioData.slice(this.audioDataOffset)
    this.audioDataOffset += audioData.length
    let audioBuffer = this.audioContext.createBuffer(1, audioData.length, 22050)
    let nowBuffering = audioBuffer.getChannelData(0)
    if (audioBuffer.copyToChannel) {
      audioBuffer.copyToChannel(new Float32Array(audioData), 0, 0)
    } else {
      for (let i = 0; i < audioData.length; i++) {
        nowBuffering[i] = audioData[i]
      }
    }
    let bufferSource = this.bufferSource = this.audioContext.createBufferSource()
    bufferSource.buffer = audioBuffer
    bufferSource.connect(this.audioContext.destination)
    bufferSource.start()
    bufferSource.onended = event => {
      if (this.status !== 'play') {
        return
      }
      if (this.audioDataOffset < this.audioData.length) {
        this.audioPlay()
      } else {
        this.audioStop()
      }
    }
  }

  // 音频播放结束
  audioStop () {
    this.setStatus('endPlay')
    clearTimeout(this.playTimeout)
    this.audioDataOffset = 0
    if (this.bufferSource) {
      try {
        this.bufferSource.stop()
      } catch (e) {
        console.log(e)
      }
    }
  }

  start () {
    if (this.audioData.length) {
      this.audioPlay()
    } else {
      if (!this.audioContext) {
        this.audioInit()
      }
      if (!this.audioContext) {
        alert('该浏览器不支持webAudioApi相关接口')
        return
      }
      this.connectWebSocket()
    }
  }

  stop () {
    this.audioStop()
  }
}

// ======================开始调用=============================
let vConsole = new VConsole()
let ttsRecorder = new TTSRecorder()
ttsRecorder.onWillStatusChange = function (oldStatus, status) {
  // 可以在这里进行页面中一些交互逻辑处理：按钮交互等
  // 按钮中的文字
  let btnState = {
    init: '立即合成',
    ttsing: '正在合成',
    play: '停止播放',
    endPlay: '重新播放',
    errorTTS: '合成失败',
  }
  $('.audio-ctrl-btn')
    .removeClass(oldStatus)
    .addClass(status)
    .text(btnState[status])
}

$('#guli').change(function () {
  let { checked } = this
  let text
  if (checked) {
    text = 'ياخشىمۇسىز، شىنجاڭ ئۇنىۋېرسىتېتى شۈنفېي ئاۋاز كىرىشتۈرۈش سېستىمىسىنى ئىشلىتىشىڭىزنى قىزغىن قارشى ئالىمىز،  مەن گۈلنۇر بولىمەن.'
    ttsRecorder.setParams({
      voiceName: 'guli',
      tte: 'unicode',
      text: text
    })
  } else {
    let text = '我是默认文本'
    ttsRecorder.setParams({
      voiceName: 'xiaoyan',
      tte: 'UTF8',
      text: '我是默认文本'
    })
  }
  $('#input_text').val(text)
})

let array = [
  '智慧小东，让生活更简单，嗯，这个裹裙设计的款型很适合你，雪纺的材质也比较飘逸，能够搭配现有的白色高跟鞋和黑色高跟鞋，但是你已经有类似的蓝色裹裙5条了哦，而且最近的花销比较大，本月余额仅剩200元，还是先不买了吧',
  // '嗯这个裹裙设计的款型很适合你，雪纺的材质也比较飘逸，能够搭配现有的白色高跟鞋和黑色高跟鞋，综合推荐指数4颗星噢。但是你已经有类似的蓝色裹裙5条了，而且最近的花销比较大，本月余额仅剩200元，还是先不买了吧',
  '唉哟，不错，主人，您晚上7点在小墨西餐厅和小明有个浪漫的约会哦。',
  '今晚17~20摄氏度，小雨，搭配您要去的西餐厅，建议穿黑色连衣裙，搭配首饰金色耳环，搭配黑色高跟鞋',
  '好的，主人，已经在智能衣柜中找出整套搭配，还有雨伞哦～对了主人，您最近缺铁，建议会多吃点西兰花哦，可以点他们家的蒜蓉西兰花，要为您提前预约点好吗？',
  '好勒，主人，已为您点好，制作时间12分钟，路程15分钟，车已到楼下，去了就可以吃了呢',
  '主人主人，您的颈椎3至7关节突出，最近情况有点严重，饭店附近的正骨店评分4.5，针对性治疗方案好，要为您预约晚上9点的按摩吗',
  '好嘞，主人，已为您预约了晚上9点的按摩，您和小明两位的位置，还有专车也已备好',
  '我得为您的终身大事考虑啊，智慧小东让生活更简单'
]
let videoCount = 0

$('#my-audio-ctrl-btn').click(function () {
  setParams()
  if (['init', 'endPlay', 'errorTTS'].indexOf(ttsRecorder.status) > -1) {
    ttsRecorder.start()
  } else {
    ttsRecorder.stop()
  }
})

function startTrasform () {
  setParams()
  if (['init', 'endPlay', 'errorTTS'].indexOf(ttsRecorder.status) > -1) {
    console.log(44444, 123123)
    ttsRecorder.start()
  } else {
    ttsRecorder.stop()
  }
}

// 设置固定语言
function setParams () {
  let val = array[videoCount];
  ttsRecorder.setParams({
    text: val
  })
  videoCount++
}
$('.download-wav').click(function () {
  if (ttsRecorder.rawAudioData.length) {
    downloadWAV(new DataView(new Int16Array(ttsRecorder.rawAudioData).buffer), 16000, 16)
  } else {
    alert('请先合成')
  }
})
$('.download-pcm').click(function () {
  if (ttsRecorder.rawAudioData.length) {
    downloadPCM(new Int16Array(ttsRecorder.rawAudioData))
  } else {
    alert('请先合成')
  }
})
$('#input_text').change(function () {
  ttsRecorder.setParams({
    text: this.value
  })
})

window.addEventListener('message', function (event) {
  console.log('文字转语音接收', '通信成功', event, event.data.data === 'start')

  if (event.data.data === 'start') {
    $('#my-audio-ctrl-btn').click()
  }
  //
});
