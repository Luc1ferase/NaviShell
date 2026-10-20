/**
 * Translations registered into the plugin's i18n namespace on activation.
 *
 * Key groups: `panel.*` (panel chrome and the host identity strip), `command.*`,
 * `target.*`, `toolbar.*`, `state.*`, `error.*`, `note.*` (the non-fatal problems the
 * collectors report in `Snapshot.notes`), and one group per section: `cpu.*`, `memory.*`,
 * `gpu.*`, `disk.*`. Every key exists in every locale (minus the `_one` plural form,
 * which only English has a category for).
 */

export const en: Record<string, string> = {
  // -- panel chrome ---------------------------------------------------------
  'panel.title': 'Hardware',
  'panel.overview': 'Overview',
  'panel.notes': 'Notes',
  'panel.hostname': 'Host',
  'panel.os': 'OS',
  'panel.kernel': 'Kernel',
  'panel.uptime': 'Uptime',

  // -- commands -------------------------------------------------------------
  'command.open': 'Show the hardware monitor',
  'command.refresh': 'Sample the hardware now',

  // -- targets --------------------------------------------------------------
  'target.local': 'This machine',

  // -- toolbar --------------------------------------------------------------
  'toolbar.target': 'Monitored machine',
  'toolbar.interval': 'Sample interval',
  'toolbar.intervalSeconds': '{{seconds}} s',
  'toolbar.pause': 'Pause sampling',
  'toolbar.resume': 'Resume sampling',
  'toolbar.refresh': 'Sample now',
  'toolbar.retry': 'Retry',
  'toolbar.updatedAgo': 'updated {{ago}} ago',
  'toolbar.never': 'not sampled yet',
  'toolbar.gpuView': 'GPU layout',
  'toolbar.gpuViewAuto': 'Automatic layout',
  'toolbar.gpuViewCards': 'Cards',
  'toolbar.gpuViewTable': 'Table',
  'toolbar.gpuSort': 'GPU order',
  'toolbar.gpuSortIndex': 'By index',
  'toolbar.gpuSortUtilization': 'By load',
  'toolbar.gpuSortMemory': 'By memory',
  'toolbar.gpuSortTemperature': 'By temperature',
  'toolbar.showDisks': 'Show disks',
  'toolbar.hideDisks': 'Hide disks',

  // -- status ---------------------------------------------------------------
  'state.idle': 'Idle',
  'state.sampling': 'Sampling',
  'state.ok': 'Live',
  'state.error': 'Error',
  'state.paused': 'Paused',
  'state.pendingShort': '…',
  'state.waitingFirstSample': 'Waiting for the first sample…',
  'state.noGpu': 'No GPU detected',
  'state.noDisks': 'No disks reported',

  // -- errors ---------------------------------------------------------------
  'error.title': 'Sampling failed',
  'error.unsupportedPlatform': 'Unsupported platform: {{platform}}',

  // -- notes from the collectors --------------------------------------------
  'note.noGpuTool': 'No GPU tool found (nvidia-smi / rocm-smi); GPUs are listed without live data',
  'note.gpuToolFailed': 'The GPU tool returned an error; is the driver loaded?',
  'note.noGpuUtilization': 'This platform reports no live GPU utilisation for some cards',

  // -- CPU ------------------------------------------------------------------
  'cpu.title': 'CPU',
  'cpu.usage': 'Load',
  'cpu.model': 'CPU',
  'cpu.coresThreads': '{{cores}} cores / {{threads}} threads',
  'cpu.coresOnly': '{{cores}} cores',
  'cpu.threadsOnly': '{{threads}} threads',
  'cpu.temperature': 'Temp',
  'cpu.perCore': 'Per logical CPU',
  'cpu.coreTooltip': 'cpu{{index}} {{percent}}',
  'cpu.history': 'CPU load history',
  'cpu.loadAvg': 'Load average',

  // -- memory ---------------------------------------------------------------
  'memory.title': 'Memory',
  'memory.used': 'Used',
  'memory.available': 'Available',
  'memory.swap': 'Swap',
  'memory.noSwap': 'none',
  'memory.history': 'Memory usage history',

  // -- GPUs -----------------------------------------------------------------
  'gpu.title': 'GPUs',
  'gpu.count': 'GPUs',
  'gpu.avgUtilization': 'Average load',
  'gpu.totalMemory': 'Memory',
  'gpu.totalPower': 'Power',
  'gpu.hottest': 'Hottest',
  'gpu.processes': 'Procs',
  'gpu.utilization': 'Load',
  'gpu.memory': 'Memory',
  'gpu.memoryUtilization': 'Memory bus load',
  'gpu.temperature': 'Temp',
  'gpu.power': 'Power',
  'gpu.fan': 'Fan',
  'gpu.clock': 'Clock',
  'gpu.memClock': 'Memory clock',
  'gpu.index': '#',
  'gpu.name': 'Name',
  'gpu.busId': 'Bus',
  'gpu.driver': 'Driver',
  'gpu.history': 'GPU {{index}} load history',
  'gpu.historyColumn': 'Load history',
  // i18next picks the `_one` / `_other` form from `count`; the bare key stays as the
  // fallback for a language pack that does not spell the plural forms out.
  'gpu.processCount': '{{count}} procs',
  'gpu.processCount_one': '{{count}} proc',
  'gpu.processCount_other': '{{count}} procs',
  'gpu.moreProcesses': '… and {{count}} more',
  'gpu.noProcesses': 'no compute process',
  'gpu.vendorNvidia': 'NVIDIA',
  'gpu.vendorAmd': 'AMD',
  'gpu.vendorIntel': 'Intel',
  'gpu.vendorApple': 'Apple',
  'gpu.vendorOther': 'GPU',

  // -- disks ----------------------------------------------------------------
  'disk.title': 'Disks',
  'disk.filesystem': 'Filesystem',
};

export const zhCN: Record<string, string> = {
  // -- panel chrome ---------------------------------------------------------
  'panel.title': '硬件',
  'panel.overview': '概览',
  'panel.notes': '提示',
  'panel.hostname': '主机名',
  'panel.os': '系统',
  'panel.kernel': '内核',
  'panel.uptime': '运行时间',

  // -- commands -------------------------------------------------------------
  'command.open': '打开硬件监视器',
  'command.refresh': '立即采样硬件状态',

  // -- targets --------------------------------------------------------------
  'target.local': '本机',

  // -- toolbar --------------------------------------------------------------
  'toolbar.target': '监视的机器',
  'toolbar.interval': '采样间隔',
  'toolbar.intervalSeconds': '{{seconds}} 秒',
  'toolbar.pause': '暂停采样',
  'toolbar.resume': '继续采样',
  'toolbar.refresh': '立即采样',
  'toolbar.retry': '重试',
  'toolbar.updatedAgo': '{{ago}} 前更新',
  'toolbar.never': '尚未采样',
  'toolbar.gpuView': 'GPU 布局',
  'toolbar.gpuViewAuto': '自动布局',
  'toolbar.gpuViewCards': '卡片布局',
  'toolbar.gpuViewTable': '表格布局',
  'toolbar.gpuSort': 'GPU 排序',
  'toolbar.gpuSortIndex': '按编号',
  'toolbar.gpuSortUtilization': '按使用率',
  'toolbar.gpuSortMemory': '按显存',
  'toolbar.gpuSortTemperature': '按温度',
  'toolbar.showDisks': '显示磁盘',
  'toolbar.hideDisks': '隐藏磁盘',

  // -- status ---------------------------------------------------------------
  'state.idle': '空闲',
  'state.sampling': '采样中',
  'state.ok': '实时',
  'state.error': '错误',
  'state.paused': '已暂停',
  'state.pendingShort': '…',
  'state.waitingFirstSample': '正在等待首次采样…',
  'state.noGpu': '未检测到 GPU',
  'state.noDisks': '未报告磁盘',

  // -- errors ---------------------------------------------------------------
  'error.title': '采样失败',
  'error.unsupportedPlatform': '不支持的平台：{{platform}}',

  // -- notes from the collectors --------------------------------------------
  'note.noGpuTool': '未找到 GPU 工具（nvidia-smi / rocm-smi）；仅列出 GPU，没有实时数据',
  'note.gpuToolFailed': 'GPU 工具返回了错误；请确认驱动已加载',
  'note.noGpuUtilization': '当前平台不提供部分显卡的实时使用率',

  // -- CPU ------------------------------------------------------------------
  'cpu.title': 'CPU',
  'cpu.usage': '使用率',
  'cpu.model': '处理器',
  'cpu.coresThreads': '{{cores}} 核 / {{threads}} 线程',
  'cpu.coresOnly': '{{cores}} 核',
  'cpu.threadsOnly': '{{threads}} 线程',
  'cpu.temperature': '温度',
  'cpu.perCore': '各逻辑核心',
  'cpu.coreTooltip': 'cpu{{index}} {{percent}}',
  'cpu.history': 'CPU 使用率历史',
  'cpu.loadAvg': '平均负载',

  // -- memory ---------------------------------------------------------------
  'memory.title': '内存',
  'memory.used': '已用',
  'memory.available': '可用',
  'memory.swap': '交换空间',
  'memory.noSwap': '无',
  'memory.history': '内存使用率历史',

  // -- GPUs -----------------------------------------------------------------
  'gpu.title': 'GPU',
  'gpu.count': 'GPU 数量',
  'gpu.avgUtilization': '平均使用率',
  'gpu.totalMemory': '显存',
  'gpu.totalPower': '功耗',
  'gpu.hottest': '最高温度',
  'gpu.processes': '进程',
  'gpu.utilization': '使用率',
  'gpu.memory': '显存',
  'gpu.memoryUtilization': '显存带宽使用率',
  'gpu.temperature': '温度',
  'gpu.power': '功耗',
  'gpu.fan': '风扇',
  'gpu.clock': '核心频率',
  'gpu.memClock': '显存频率',
  'gpu.index': '#',
  'gpu.name': '名称',
  'gpu.busId': '总线',
  'gpu.driver': '驱动',
  'gpu.history': 'GPU {{index}} 使用率历史',
  'gpu.historyColumn': '使用率历史',
  'gpu.processCount': '{{count}} 个进程',
  'gpu.processCount_other': '{{count}} 个进程',
  'gpu.moreProcesses': '…另有 {{count}} 个',
  'gpu.noProcesses': '无计算进程',
  'gpu.vendorNvidia': 'NVIDIA',
  'gpu.vendorAmd': 'AMD',
  'gpu.vendorIntel': 'Intel',
  'gpu.vendorApple': 'Apple',
  'gpu.vendorOther': 'GPU',

  // -- disks ----------------------------------------------------------------
  'disk.title': '磁盘',
  'disk.filesystem': '文件系统',
};

/**
 * Japanese. Katakana compounds are spaced the way the host’s own ja strings space them
 * (「ローカル ターミナル」), and "sample" is 計測 throughout.
 * Japanese has no "one" plural category, so `_other` plus the bare key is enough.
 */
export const ja: Record<string, string> = {
  // -- panel chrome ---------------------------------------------------------
  'panel.title': 'ハードウェア',
  'panel.overview': '概要',
  'panel.notes': '注意事項',
  'panel.hostname': 'ホスト',
  'panel.os': 'OS',
  'panel.kernel': 'カーネル',
  'panel.uptime': '稼働時間',

  // -- commands -------------------------------------------------------------
  'command.open': 'ハードウェア モニターを表示',
  'command.refresh': 'ハードウェアを今すぐ計測',

  // -- targets --------------------------------------------------------------
  'target.local': 'このマシン',

  // -- toolbar --------------------------------------------------------------
  'toolbar.target': '計測するマシン',
  'toolbar.interval': '計測間隔',
  'toolbar.intervalSeconds': '{{seconds}} 秒',
  'toolbar.pause': '計測を一時停止',
  'toolbar.resume': '計測を再開',
  'toolbar.refresh': '今すぐ計測',
  'toolbar.retry': '再試行',
  'toolbar.updatedAgo': '{{ago}}前に更新',
  'toolbar.never': '未計測',
  'toolbar.gpuView': 'GPU のレイアウト',
  'toolbar.gpuViewAuto': '自動レイアウト',
  'toolbar.gpuViewCards': 'カード',
  'toolbar.gpuViewTable': 'テーブル',
  'toolbar.gpuSort': 'GPU の並び順',
  'toolbar.gpuSortIndex': '番号順',
  'toolbar.gpuSortUtilization': '使用率順',
  'toolbar.gpuSortMemory': 'メモリ順',
  'toolbar.gpuSortTemperature': '温度順',
  'toolbar.showDisks': 'ディスクを表示',
  'toolbar.hideDisks': 'ディスクを非表示',

  // -- status ---------------------------------------------------------------
  'state.idle': '待機中',
  'state.sampling': '計測中',
  'state.ok': 'ライブ',
  'state.error': 'エラー',
  'state.paused': '一時停止中',
  'state.pendingShort': '…',
  'state.waitingFirstSample': '最初の計測を待っています…',
  'state.noGpu': 'GPU が見つかりません',
  'state.noDisks': 'ディスクの情報がありません',

  // -- errors ---------------------------------------------------------------
  'error.title': '計測に失敗しました',
  'error.unsupportedPlatform': 'サポートされていないプラットフォーム: {{platform}}',

  // -- notes from the collectors --------------------------------------------
  'note.noGpuTool':
    'GPU ツール (nvidia-smi / rocm-smi) が見つかりません。GPU は一覧に表示されますが、ライブ データはありません',
  'note.gpuToolFailed': 'GPU ツールがエラーを返しました。ドライバーは読み込まれていますか?',
  'note.noGpuUtilization': 'このプラットフォームでは、一部のカードのライブ使用率を取得できません',

  // -- CPU ------------------------------------------------------------------
  'cpu.title': 'CPU',
  'cpu.usage': '使用率',
  'cpu.model': 'CPU',
  'cpu.coresThreads': '{{cores}} コア / {{threads}} スレッド',
  'cpu.coresOnly': '{{cores}} コア',
  'cpu.threadsOnly': '{{threads}} スレッド',
  'cpu.temperature': '温度',
  'cpu.perCore': '論理 CPU ごと',
  'cpu.coreTooltip': 'cpu{{index}} {{percent}}',
  'cpu.history': 'CPU 使用率の履歴',
  'cpu.loadAvg': '平均負荷',

  // -- memory ---------------------------------------------------------------
  'memory.title': 'メモリ',
  'memory.used': '使用中',
  'memory.available': '空き',
  'memory.swap': 'スワップ',
  'memory.noSwap': 'なし',
  'memory.history': 'メモリ使用率の履歴',

  // -- GPUs -----------------------------------------------------------------
  'gpu.title': 'GPU',
  'gpu.count': 'GPU 数',
  'gpu.avgUtilization': '平均使用率',
  'gpu.totalMemory': 'メモリ',
  'gpu.totalPower': '電力',
  'gpu.hottest': '最高温度',
  'gpu.processes': 'プロセス',
  'gpu.utilization': '使用率',
  'gpu.memory': 'メモリ',
  'gpu.memoryUtilization': 'メモリ帯域の使用率',
  'gpu.temperature': '温度',
  'gpu.power': '電力',
  'gpu.fan': 'ファン',
  'gpu.clock': 'クロック',
  'gpu.memClock': 'メモリ クロック',
  'gpu.index': '#',
  'gpu.name': '名前',
  'gpu.busId': 'バス',
  'gpu.driver': 'ドライバー',
  'gpu.history': 'GPU {{index}} の使用率の履歴',
  'gpu.historyColumn': '使用率の履歴',
  'gpu.processCount': '{{count}} プロセス',
  'gpu.processCount_other': '{{count}} プロセス',
  'gpu.moreProcesses': '…ほか {{count}} 件',
  'gpu.noProcesses': '計算プロセスなし',
  'gpu.vendorNvidia': 'NVIDIA',
  'gpu.vendorAmd': 'AMD',
  'gpu.vendorIntel': 'Intel',
  'gpu.vendorApple': 'Apple',
  'gpu.vendorOther': 'GPU',

  // -- disks ----------------------------------------------------------------
  'disk.title': 'ディスク',
  'disk.filesystem': 'ファイル システム',
};

/**
 * Traditional Chinese (Taiwan wording): 顯示卡, 記憶體, 硬碟, 執行緒, 時脈,
 * 驅動程式, 檔案系統, 處理程序, and 取樣 for sampling. Like Japanese it has no
 * "one" plural category.
 */
export const zhTW: Record<string, string> = {
  // -- panel chrome ---------------------------------------------------------
  'panel.title': '硬體',
  'panel.overview': '概觀',
  'panel.notes': '提示',
  'panel.hostname': '主機名稱',
  'panel.os': '系統',
  'panel.kernel': '核心',
  'panel.uptime': '運作時間',

  // -- commands -------------------------------------------------------------
  'command.open': '開啟硬體監視器',
  'command.refresh': '立即取樣硬體狀態',

  // -- targets --------------------------------------------------------------
  'target.local': '本機',

  // -- toolbar --------------------------------------------------------------
  'toolbar.target': '監視的機器',
  'toolbar.interval': '取樣間隔',
  'toolbar.intervalSeconds': '{{seconds}} 秒',
  'toolbar.pause': '暫停取樣',
  'toolbar.resume': '繼續取樣',
  'toolbar.refresh': '立即取樣',
  'toolbar.retry': '重試',
  'toolbar.updatedAgo': '{{ago}} 前更新',
  'toolbar.never': '尚未取樣',
  'toolbar.gpuView': '顯示卡版面',
  'toolbar.gpuViewAuto': '自動版面',
  'toolbar.gpuViewCards': '卡片版面',
  'toolbar.gpuViewTable': '表格版面',
  'toolbar.gpuSort': '顯示卡排序',
  'toolbar.gpuSortIndex': '依編號',
  'toolbar.gpuSortUtilization': '依使用率',
  'toolbar.gpuSortMemory': '依記憶體',
  'toolbar.gpuSortTemperature': '依溫度',
  'toolbar.showDisks': '顯示硬碟',
  'toolbar.hideDisks': '隱藏硬碟',

  // -- status ---------------------------------------------------------------
  'state.idle': '閒置',
  'state.sampling': '取樣中',
  'state.ok': '即時',
  'state.error': '錯誤',
  'state.paused': '已暫停',
  'state.pendingShort': '…',
  'state.waitingFirstSample': '正在等待第一次取樣…',
  'state.noGpu': '未偵測到顯示卡',
  'state.noDisks': '沒有硬碟資訊',

  // -- errors ---------------------------------------------------------------
  'error.title': '取樣失敗',
  'error.unsupportedPlatform': '不支援的平台：{{platform}}',

  // -- notes from the collectors --------------------------------------------
  'note.noGpuTool': '找不到顯示卡工具（nvidia-smi / rocm-smi）；只會列出顯示卡，沒有即時資料',
  'note.gpuToolFailed': '顯示卡工具傳回錯誤；請確認驅動程式已載入',
  'note.noGpuUtilization': '目前平台不提供部分顯示卡的即時使用率',

  // -- CPU ------------------------------------------------------------------
  'cpu.title': 'CPU',
  'cpu.usage': '使用率',
  'cpu.model': '處理器',
  'cpu.coresThreads': '{{cores}} 核心 / {{threads}} 執行緒',
  'cpu.coresOnly': '{{cores}} 核心',
  'cpu.threadsOnly': '{{threads}} 執行緒',
  'cpu.temperature': '溫度',
  'cpu.perCore': '各邏輯核心',
  'cpu.coreTooltip': 'cpu{{index}} {{percent}}',
  'cpu.history': 'CPU 使用率歷史',
  'cpu.loadAvg': '平均負載',

  // -- memory ---------------------------------------------------------------
  'memory.title': '記憶體',
  'memory.used': '已用',
  'memory.available': '可用',
  'memory.swap': '交換空間',
  'memory.noSwap': '無',
  'memory.history': '記憶體使用率歷史',

  // -- GPUs -----------------------------------------------------------------
  'gpu.title': '顯示卡',
  'gpu.count': '顯示卡數量',
  'gpu.avgUtilization': '平均使用率',
  'gpu.totalMemory': '記憶體',
  'gpu.totalPower': '功耗',
  'gpu.hottest': '最高溫度',
  'gpu.processes': '處理程序',
  'gpu.utilization': '使用率',
  'gpu.memory': '記憶體',
  'gpu.memoryUtilization': '記憶體頻寬使用率',
  'gpu.temperature': '溫度',
  'gpu.power': '功耗',
  'gpu.fan': '風扇',
  'gpu.clock': '時脈',
  'gpu.memClock': '記憶體時脈',
  'gpu.index': '#',
  'gpu.name': '名稱',
  'gpu.busId': '匯流排',
  'gpu.driver': '驅動程式',
  'gpu.history': '顯示卡 {{index}} 使用率歷史',
  'gpu.historyColumn': '使用率歷史',
  'gpu.processCount': '{{count}} 個處理程序',
  'gpu.processCount_other': '{{count}} 個處理程序',
  'gpu.moreProcesses': '…另有 {{count}} 個',
  'gpu.noProcesses': '無運算處理程序',
  'gpu.vendorNvidia': 'NVIDIA',
  'gpu.vendorAmd': 'AMD',
  'gpu.vendorIntel': 'Intel',
  'gpu.vendorApple': 'Apple',
  'gpu.vendorOther': 'GPU',

  // -- disks ----------------------------------------------------------------
  'disk.title': '硬碟',
  'disk.filesystem': '檔案系統',
};

export const locales: Record<string, Record<string, string>> = {
  en,
  'zh-CN': zhCN,
  ja,
  'zh-TW': zhTW,
};
