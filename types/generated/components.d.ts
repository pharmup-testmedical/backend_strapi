import type { Schema, Struct } from '@strapi/strapi';

export interface ReceiptItemItem extends Struct.ComponentSchema {
  collectionName: 'components_receipt_item_items';
  info: {
    description: '';
    displayName: '\u041F\u043E\u0437\u0438\u0446\u0438\u044F \u0434\u043B\u044F \u043A\u0435\u0448\u0431\u044D\u043A\u0430';
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
    displayName: '\u0421\u0432\u043E\u0439\u0441\u0442\u0432\u0430 \u043F\u043E\u0437\u0438\u0446\u0438\u0438 \u0432 \u0447\u0435\u043A\u0435';
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
    displayName: '\u0421\u0442\u043E\u0440\u043E\u043D\u043D\u044F\u044F \u043F\u043E\u0437\u0438\u0446\u0438\u044F';
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
