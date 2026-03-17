import type { Schema, Struct } from '@strapi/strapi';

export interface CompletedTasksOtskanirujtePervyeCheki
  extends Struct.ComponentSchema {
  collectionName: 'components_completed_tasks_otskanirujte_pervye_cheki';
  info: {
    displayName: '\u041E\u0442\u0441\u043A\u0430\u043D\u0438\u0440\u0443\u0439\u0442\u0435 \u043F\u0435\u0440\u0432\u044B\u0435 \u0447\u0435\u043A\u0438';
    icon: 'layer';
  };
  attributes: {
    firstReceipts: Schema.Attribute.Relation<
      'oneToMany',
      'api::receipt.receipt'
    >;
  };
}

export interface CompletedTasksPostavitOczenku extends Struct.ComponentSchema {
  collectionName: 'components_completed_tasks_postavit_oczenku';
  info: {
    displayName: '\u041F\u043E\u0441\u0442\u0430\u0432\u0438\u0442\u044C \u043E\u0446\u0435\u043D\u043A\u0443';
    icon: 'star';
  };
  attributes: {
    verified: Schema.Attribute.Boolean;
  };
}

export interface CompletedTasksPriglashenieKolleg
  extends Struct.ComponentSchema {
  collectionName: 'components_completed_tasks_priglashenie_kolleg';
  info: {
    displayName: '\u041F\u0440\u0438\u0433\u043B\u0430\u0448\u0435\u043D\u0438\u0435 \u043A\u043E\u043B\u043B\u0435\u0433';
    icon: 'user';
  };
  attributes: {
    invitedUser: Schema.Attribute.Relation<
      'oneToOne',
      'plugin::users-permissions.user'
    >;
  };
}

export interface MainPagePromoBanner extends Struct.ComponentSchema {
  collectionName: 'components_main_page_promo_banners';
  info: {
    description: '';
    displayName: '\u041F\u0440\u043E\u043C\u043E-\u0431\u0430\u043D\u043D\u0435\u0440';
  };
  attributes: {
    image: Schema.Attribute.Media<'images'> & Schema.Attribute.Required;
    navigationRoute: Schema.Attribute.String;
    title: Schema.Attribute.String;
  };
}

export interface PublicAgreements extends Struct.ComponentSchema {
  collectionName: 'components_public_agreements';
  info: {
    description: '';
    displayName: '\u0421\u043E\u0433\u043B\u0430\u0448\u0435\u043D\u0438\u044F';
  };
  attributes: {
    personalDataPolicy: Schema.Attribute.String & Schema.Attribute.Unique;
    userAgreementTerms: Schema.Attribute.String & Schema.Attribute.Unique;
  };
}

export interface ReceiptItemItem extends Struct.ComponentSchema {
  collectionName: 'components_receipt_item_items';
  info: {
    description: '';
    displayName: '\u041F\u043E\u0437\u0438\u0446\u0438\u044F \u0434\u043B\u044F \u043A\u0435\u0448\u0431\u044D\u043A\u0430';
    icon: 'shoppingCart';
  };
  attributes: {
    cashback: Schema.Attribute.Decimal & Schema.Attribute.Required;
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
    displayName: '\u0421\u0432\u043E\u0439\u0441\u0442\u0432\u0430 \u043F\u043E\u0437\u0438\u0446\u0438\u0438';
  };
  attributes: {
    department: Schema.Attribute.String & Schema.Attribute.Required;
    measureUnit: Schema.Attribute.String & Schema.Attribute.Required;
    quantity: Schema.Attribute.Decimal & Schema.Attribute.Required;
    totalPrice: Schema.Attribute.Decimal & Schema.Attribute.Required;
    unitPrice: Schema.Attribute.Decimal & Schema.Attribute.Required;
  };
}

export interface ReceiptItemProductClaim extends Struct.ComponentSchema {
  collectionName: 'components_receipt_item_product_claims';
  info: {
    description: '';
    displayName: '\u0421\u0442\u043E\u0440\u043E\u043D\u043D\u044F\u044F \u043F\u043E\u0437\u0438\u0446\u0438\u044F';
    icon: 'thumbDown';
  };
  attributes: {
    name: Schema.Attribute.String & Schema.Attribute.Required;
    props: Schema.Attribute.Component<'receipt-item.item-props', false> &
      Schema.Attribute.Required;
  };
}

export interface SettingsBanking extends Struct.ComponentSchema {
  collectionName: 'components_settings_bankings';
  info: {
    description: '';
    displayName: '\u0411\u0430\u043D\u043A\u0438\u043D\u0433';
  };
  attributes: {
    minWithdrawAmount: Schema.Attribute.Decimal &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<500>;
  };
}

export interface SettingsPromo extends Struct.ComponentSchema {
  collectionName: 'components_settings_promos';
  info: {
    description: '';
    displayName: '\u0410\u043A\u0446\u0438\u0438';
  };
  attributes: {
    deadlineNotificationDays: Schema.Attribute.Integer &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<3>;
    receiptValidDays: Schema.Attribute.Integer &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<5>;
  };
}

export interface TasksOtskanirujtePervyeCheki extends Struct.ComponentSchema {
  collectionName: 'components_tasks_otskanirujte_pervye_cheki';
  info: {
    displayName: '\u041E\u0442\u0441\u043A\u0430\u043D\u0438\u0440\u0443\u0439\u0442\u0435 \u043F\u0435\u0440\u0432\u044B\u0435 \u0447\u0435\u043A\u0438';
    icon: 'layer';
  };
  attributes: {
    active: Schema.Attribute.Boolean &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<true>;
    cashback: Schema.Attribute.Decimal &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMax<
        {
          min: 0;
        },
        number
      > &
      Schema.Attribute.DefaultTo<0>;
    numReceiptsRequired: Schema.Attribute.Integer &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMax<
        {
          min: 1;
        },
        number
      > &
      Schema.Attribute.DefaultTo<3>;
  };
}

export interface TasksPostavitOczenku extends Struct.ComponentSchema {
  collectionName: 'components_tasks_postavit_oczenku';
  info: {
    description: '';
    displayName: '\u041F\u043E\u0441\u0442\u0430\u0432\u0438\u0442\u044C \u043E\u0446\u0435\u043D\u043A\u0443';
    icon: 'star';
  };
  attributes: {
    active: Schema.Attribute.Boolean &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<true>;
    ratingCooldownDays: Schema.Attribute.Integer &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMax<
        {
          min: 0;
        },
        number
      > &
      Schema.Attribute.DefaultTo<14>;
  };
}

export interface TasksPriglashenieKolleg extends Struct.ComponentSchema {
  collectionName: 'components_tasks_priglashenie_kolleg';
  info: {
    description: '';
    displayName: '\u041F\u0440\u0438\u0433\u043B\u0430\u0448\u0435\u043D\u0438\u0435 \u043A\u043E\u043B\u043B\u0435\u0433';
    icon: 'user';
  };
  attributes: {
    active: Schema.Attribute.Boolean &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<true>;
    cashback: Schema.Attribute.Decimal &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMax<
        {
          min: 0;
        },
        number
      > &
      Schema.Attribute.DefaultTo<0>;
  };
}

export interface TestTestVopros extends Struct.ComponentSchema {
  collectionName: 'components_test_test_vopros';
  info: {
    description: '';
    displayName: '\u0422\u0435\u0441\u0442 \u0432\u043E\u043F\u0440\u043E\u0441';
    icon: 'question';
  };
  attributes: {
    correctAnswer: Schema.Attribute.String & Schema.Attribute.Required;
    multipleChoice: Schema.Attribute.Component<'test.variant-otveta', true> &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMax<
        {
          min: 2;
        },
        number
      >;
    question: Schema.Attribute.Text & Schema.Attribute.Required;
  };
}

export interface TestVariantOtveta extends Struct.ComponentSchema {
  collectionName: 'components_test_variant_otveta';
  info: {
    description: '';
    displayName: '\u0412\u0430\u0440\u0438\u0430\u043D\u0442 \u043E\u0442\u0432\u0435\u0442\u0430';
    icon: 'quote';
  };
  attributes: {
    title: Schema.Attribute.Text & Schema.Attribute.Required;
  };
}

declare module '@strapi/strapi' {
  export module Public {
    export interface ComponentSchemas {
      'completed-tasks.otskanirujte-pervye-cheki': CompletedTasksOtskanirujtePervyeCheki;
      'completed-tasks.postavit-oczenku': CompletedTasksPostavitOczenku;
      'completed-tasks.priglashenie-kolleg': CompletedTasksPriglashenieKolleg;
      'main-page.promo-banner': MainPagePromoBanner;
      'public.agreements': PublicAgreements;
      'receipt-item.item': ReceiptItemItem;
      'receipt-item.item-props': ReceiptItemItemProps;
      'receipt-item.product-claim': ReceiptItemProductClaim;
      'settings.banking': SettingsBanking;
      'settings.promo': SettingsPromo;
      'tasks.otskanirujte-pervye-cheki': TasksOtskanirujtePervyeCheki;
      'tasks.postavit-oczenku': TasksPostavitOczenku;
      'tasks.priglashenie-kolleg': TasksPriglashenieKolleg;
      'test.test-vopros': TestTestVopros;
      'test.variant-otveta': TestVariantOtveta;
    }
  }
}
