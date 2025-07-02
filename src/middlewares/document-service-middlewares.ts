// import { errors } from '@strapi/utils';

const aliasUid = 'api::product-alias.product-alias';
const receiptUid = 'api::receipt.receipt';
const updateAction = 'update';

// export const registerAliasVerifierMiddleware = ({ strapi }) => {
//   strapi.documents.use(async (context, next) => {
//     // Only trigger for 'update' action on product-alias
//     if (context.uid !== aliasUid || context.action !== updateAction) {
//       return await next();
//     }

//     const { data, documentId } = context.params;
//     const user = context.state?.user;
//     strapi.log.info(`context.state = ${JSON.stringify(context.state, null, 2)}`);
//     strapi.log.info(`Alias Verifier middleware: user = ${JSON.stringify(user, null, 2)}`);

//     // Log the incoming data for debugging
//     strapi.log.info(`Alias Verifier middleware: context.params.data = ${JSON.stringify(data, null, 2)}`);

//     // Check if user has 'Alias Verifier' role (adjust role name or ID as needed)
//     const isAliasVerifier = user?.role?.name === 'Alias Verifier'; // Or use role.id if known

//     if (isAliasVerifier) {
//       // Ensure data contains only verificationStatus
//       const updatedFields = Object.keys(data);
//       if (updatedFields.length !== 1 || updatedFields[0] !== 'verificationStatus') {
//         throw new errors.ForbiddenError('Alias Verifier can only update verificationStatus and nothing else');
//       }

//       // Ensure new verificationStatus is 'verified' or 'rejected'
//       const newStatus = data.verificationStatus;
//       if (!['verified', 'rejected'].includes(newStatus)) {
//         throw new errors.ForbiddenError('Alias Verifier can only set verificationStatus to verified or rejected');
//       }

//       // Check if current verificationStatus is 'unverified'
//       const currentAlias = await strapi.documents(aliasUid).findOne({
//         documentId,
//         fields: ['verificationStatus'],
//       });

//       if (!currentAlias || currentAlias.verificationStatus !== 'unverified') {
//         throw new errors.ForbiddenError('Alias Verifier can only update unverified aliases');
//       }

//       // Restrict the update payload to only verificationStatus
//       context.params.data = { verificationStatus: newStatus };

//       strapi.log.info(`Alias Verifier updating alias ${documentId} verificationStatus to ${newStatus}`);
//     }

//     // Proceed to next middleware (or update)
//     return await next();
//   });
// };

// export const registerProductAliasMiddleware = ({ strapi }) => {
//   strapi.documents.use(async (context, next) => {

//     // Access the authenticated user
//     const user = context.state?.user;

//     if (user) {
//       // You can now use user properties in your logic
//       const isAdmin = user.role?.name === 'Administrator';
//     }

//     // Only trigger for 'update' action on product-alias
//     if (context.uid !== aliasUid || context.action !== updateAction) {
//       return await next();
//     }

//     const { documentId, data } = context.params;

//     // Fetch previous alias state
//     const previousAlias = await strapi.documents(aliasUid).findOne({
//       documentId,
//       fields: ['verificationStatus'],
//     });

//     // Prevent update if alias isn't unverified
//     if (!previousAlias || previousAlias.verificationStatus !== 'unverified') {
//       const currentStatus = previousAlias?.verificationStatus || 'not found';
//       throw new Error(
//         `Cannot update alias ${documentId} - current status is '${currentStatus}'. ` +
//         `Only aliases with 'unverified' status can be updated to 'verified' or 'rejected'.`
//       );
//     }

//     const newStatus = data.verificationStatus;

//     // Check if verificationStatus is changing to 'verified' or 'rejected'
//     if (!['verified', 'rejected'].includes(newStatus)) {
//       strapi.log.warn(`No relevant status change for alias ${documentId}: ${newStatus}`);
//       return await next();
//     }

//     // Proceed with update after calling next() to ensure alias is updated
//     const result = await next();

//     try {
//       // [Rest of your existing receipt update logic...]
//       // Find receipts with manual_review status and items linked to this alias
//       const receipts = await strapi.documents(receiptUid).findMany({
//         filters: { verificationStatus: 'manual_review' },
//         populate: {
//           items: {
//             on: {
//               'receipt-item.item': {
//                 fields: ['verificationStatus'],
//                 populate: {
//                   productAlias: {
//                     fields: ['documentId'],
//                   },
//                 },
//               },
//               'receipt-item.product-claim': {
//                 fields: [],
//               },
//             },
//           },
//         },
//       });

//       strapi.log.info(`Found ${receipts.length} manual_review receipts for alias ${documentId}`);
//       strapi.log.info(`Receipts data: ${JSON.stringify(receipts.slice(0, 2), null, 2)}`);

//       for (const receipt of receipts) {
//         let needsUpdate = false;
//         const updatedItems = receipt.items.map((item) => {
//           if (
//             item.__component === 'receipt-item.item' &&
//             item.verificationStatus === 'manual_review' &&
//             item.productAlias?.documentId === documentId
//           ) {
//             needsUpdate = true;
//             const newItemStatus =
//               newStatus === 'verified' ? 'manually_verified_alias' : 'manually_rejected_alias';
//             return { ...item, verificationStatus: newItemStatus };
//           }
//           return item;
//         });

//         if (!needsUpdate) {
//           continue;
//         }

//         // Determine new receipt verificationStatus
//         const hasManualReview = updatedItems.some(
//           (item) =>
//             item.__component === 'receipt-item.item' &&
//             item.verificationStatus === 'manual_review'
//         );
//         const hasRejected = updatedItems.some(
//           (item) =>
//             item.__component === 'receipt-item.item' &&
//             [
//               'auto_rejected_alias',
//               'manually_rejected_alias',
//             ].includes(item.verificationStatus)
//         );
//         const allVerified = updatedItems.every(
//           (item) =>
//             item.__component === 'receipt-item.product-claim' ||
//             (item.__component === 'receipt-item.item' &&
//               [
//                 'auto_verified_canon',
//                 'auto_verified_alias',
//                 'manually_verified_alias',
//               ].includes(item.verificationStatus))
//         );

//         let newReceiptStatus = receipt.verificationStatus;
//         if (hasRejected) {
//           newReceiptStatus = 'manually_rejected';
//         } else if (allVerified && !hasManualReview) {
//           newReceiptStatus = 'manually_verified';
//         }

//         // Update receipt if status or items changed
//         if (needsUpdate || newReceiptStatus !== receipt.verificationStatus) {
//           await strapi.documents(receiptUid).update({
//             documentId: receipt.documentId,
//             data: {
//               verificationStatus: newReceiptStatus,
//               items: updatedItems,
//             },
//           });
//           strapi.log.info(
//             `Updated receipt ${receipt.documentId} to ${newReceiptStatus} after alias ${documentId} changed to ${newStatus}`
//           );
//         }
//       }
//     } catch (error) {
//       strapi.log.error(
//         `Failed to update receipts for alias ${documentId}: ${error.message}`,
//         { stack: error.stack }
//       );
//       // Continue to return result to avoid blocking alias update
//     }

//     return result;
//   });

//   strapi.server.use(async (ctx, next) => {
//     const { path, method } = ctx.request;

//     if (
//       method === 'PATCH' &&
//       path.startsWith('/api/product-aliases/')
//     ) {
//       const user = ctx.state?.user;
//       if (!user) {
//         strapi.log.warn('User not authenticated');
//       } else {
//         strapi.log.info(`Authenticated user: ${user.username}`);
//         const isAdmin = user.role?.name === 'Administrator';
//         // Store for later if needed: ctx.state.isAdmin = isAdmin;
//       }
//     }

//     await next();
//   });
// };