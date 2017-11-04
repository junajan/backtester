const _ = require('lodash')
const env = require('./env')

// general configuration
const config = {
  generalConf: true
}

module.exports = _.merge(config, env)
