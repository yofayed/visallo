import React from 'react'
import bluebird from 'bluebird'
import underscore from 'underscore'

global.Promise = bluebird
global.React = React;
global._ = underscore
if (!Object.values) Object.values = _.values

