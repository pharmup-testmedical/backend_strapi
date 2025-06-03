'use strict';

/**
 * main-page service
 */

const { createCoreService } = require('@strapi/strapi').factories;

module.exports = createCoreService('api::main-page.main-page');
