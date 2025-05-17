import type { Schema, Struct } from '@strapi/strapi';

export interface ReceiptItemItem extends Struct.ComponentSchema {
  collectionName: 'components_receipt_item_items';
  info: {
    description: '';
    displayName: 'claimedItem';
  };
  attributes: {
    claimedProduct: Schema.Attribute.Relation<
      'oneToOne',
      'api::product.product'
    >;
    name: Schema.Attribute.String & Schema.Attribute.Required;
    productAlias: Schema.Attribute.Relation<
      'oneToOne',
      'api::product-alias.product-alias'
    >;
    props: Schema.Attribute.Component<'receipt-item.item-props', false> &
      Schema.Attribute.Required;
    verificationStatus: Schema.Attribute.Enumeration<
      [
        'auto_verified_canon',
        'auto_verified_alias',
        'auto_rejected_alias',
        'manual_review',
        'manually_verified_alias',
        'manually_rejected_wrong_name',
        'manually_rejected_alias',
      ]
    > &
      Schema.Attribute.Required;
  };
}

export interface ReceiptItemItemProps extends Struct.ComponentSchema {
  collectionName: 'components_receipt_item_item_props';
  info: {
    description: 'Properties of a receipt item';
    displayName: 'itemProps';
  };
  attributes: {
    department: Schema.Attribute.String & Schema.Attribute.Required;
    measureUnit: Schema.Attribute.String & Schema.Attribute.Required;
    quantity: Schema.Attribute.Integer & Schema.Attribute.Required;
    totalPrice: Schema.Attribute.Decimal & Schema.Attribute.Required;
    unitPrice: Schema.Attribute.Decimal & Schema.Attribute.Required;
  };
}

export interface ReceiptItemProductClaim extends Struct.ComponentSchema {
  collectionName: 'components_receipt_item_product_claims';
  info: {
    description: '';
    displayName: 'unclaimedItem';
  };
  attributes: {
    name: Schema.Attribute.String & Schema.Attribute.Required;
    props: Schema.Attribute.Component<'receipt-item.item-props', false> &
      Schema.Attribute.Required;
  };
}

declare module '@strapi/strapi' {
  export module Public {
    export interface ComponentSchemas {
      'receipt-item.item': ReceiptItemItem;
      'receipt-item.item-props': ReceiptItemItemProps;
      'receipt-item.product-claim': ReceiptItemProductClaim;
    }
  }
}
