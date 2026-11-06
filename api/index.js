'use strict';

const { app } = require('@azure/functions');
const { assess } = require('./pronunciation');

app.http('pronunciation', {
  methods: ['POST'],
  authLevel: 'function',
  handler: assess,
});
