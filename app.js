require('colors')
const config = require('./config')
const Backtester = require('./lib/Backtester')

const backtester = new Backtester(config)

const testConfig = {
  // tickers: ['MOCK'],
  tickers: ['BTCUSDbit'],
  dataLimit: 20,
  capital: 10000,
  timeframe: '1hod',
  strategy: 'Rsi',
  // from: '2014-01-01',
  from: '2017-01-01',
  to: '2017-12-01',
  slippage: {
    bars: 0,
    fn: currentPrice => currentPrice.close
  },
  fees: {
    type: '%',
    // val: 0.18,
    val: 0.0,
  },
}

backtester.init(testConfig)
  .then(() => backtester.run())
