'use strict';

/**
 * receipt service
 */

const { createCoreService } = require('@strapi/strapi').factories;

module.exports = createCoreService('api::receipt.receipt');
