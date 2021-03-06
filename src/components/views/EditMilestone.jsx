import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { LPPCappedMilestones } from 'lpp-capped-milestone-token';
import { utils } from 'web3';

import { Form, Input } from 'formsy-react-components';
import { feathersClient } from './../../lib/feathersClient';
import Loader from './../Loader';
import QuillFormsy from './../QuillFormsy';
import SelectFormsy from './../SelectFormsy';
import DatePickerFormsy from './../DatePickerFormsy';

import FormsyImageUploader from './../FormsyImageUploader';
import GoBackButton from '../GoBackButton';
import {
  isOwner,
  displayTransactionError,
  getRandomWhitelistAddress,
  getTruncatedText,
  getGasPrice,
} from '../../lib/helpers';
import {
  isAuthenticated,
  checkWalletBalance,
  isInWhitelist,
  confirmBlockchainTransaction,
} from '../../lib/middleware';
import getNetwork from '../../lib/blockchain/getNetwork';
import getWeb3 from '../../lib/blockchain/getWeb3';
import LoaderButton from '../../components/LoaderButton';
import User from '../../models/User';
import GivethWallet from '../../lib/blockchain/GivethWallet';
import MilestoneItem from '../../components/MilestoneItem';
import moment from 'moment';

import Toggle from 'react-toggle'
import AddMilestoneItem from '../../components/AddMilestoneItem';
const BigNumber = require('bignumber.js');
BigNumber.config({ DECIMAL_PLACES: 18 })
/**
 * Create or edit a Milestone
 *
 *  @props
 *    isNew (bool):
 *      If set, component will load an empty model.
 *      If not set, component expects an id param and will load a milestone object from backend
 *
 *  @params
 *    id (string): an id of a milestone object
 */

class EditMilestone extends Component {
  constructor() {
    super(); 

    this.state = {
      isLoading: true,
      isSaving: false,
      formIsValid: false,

      // milestone model
      title: '',
      description: '',
      image: '',
      maxAmount: new BigNumber(0),
      fiatAmount: new BigNumber(10),
      recipientAddress: '',
      // completionDeadline: '',
      status: 'pending',
      uploadNewImage: false,
      campaignTitle: '',
      projectId: undefined,
      hasWhitelist: React.whitelist.reviewerWhitelist.length > 0,
      whitelistReviewerOptions: React.whitelist.reviewerWhitelist.map(r => ({
        value: r.address,
        title: `${r.name ? r.name : 'Anonymous user'} - ${r.address}`,
      })),
      reviewers: [],
      reviewerAddress: '',
      items: [],
      itemizeState: false,
      conversionRates: [],
      currentRate: undefined,
      date: moment().subtract(1, 'd'),
      fiatTypes: [
        {value: 'USD', title: 'USD'},
        {value: 'EUR', title: 'EUR'},
        {value: 'GBP', title: 'GBP'},
        {value: 'CHF', title: 'CHF'},
        {value: 'MXN', title: 'MXN'},
        {value: 'THB', title: 'THB'}
      ], 
      selectedFiatType: 'EUR',
    };

    if(React.whitelist.reviewerWhitelist.length > 0) {
      this.state.reviewerAddress = getRandomWhitelistAddress(
        React.whitelist.reviewerWhitelist,
      ).address
    }

    this.submit = this.submit.bind(this);
    this.setImage = this.setImage.bind(this);
    this.setMaxAmount = this.setMaxAmount.bind(this);
    this.setFiatAmount = this.setFiatAmount.bind(this);
    this.changeSelectedFiat = this.changeSelectedFiat.bind(this);
  }

  componentDidMount() {
    isAuthenticated(this.props.currentUser, this.props.wallet)
      .then(() => {
        if (!this.props.isProposed) checkWalletBalance(this.props.wallet, this.props.history);
      })
      .then(() => {
        if (!this.props.isProposed) {
          isInWhitelist(this.props.currentUser, React.whitelist.projectOwnerWhitelist);
        }
      })
      .then(() => {
        this.setState({
          campaignId: this.props.match.params.id,
          recipientAddress: this.props.currentUser.address,
        });

        // load a single milestones (when editing)
        if (!this.props.isNew) {
          feathersClient
            .service('milestones')
            .find({ query: { _id: this.props.match.params.milestoneId } })
            .then(resp => {
              const milestone = resp.data[0];
              const date = milestone.date ? moment(milestone.date) : moment();

              // convert amounts to BigNumbers
              milestone.maxAmount = new BigNumber(milestone.maxAmount)
              milestone.fiatAmount = new BigNumber(milestone.fiatAmount)
              
              if (
                !isOwner(milestone.owner.address, this.props.currentUser)
              ) {
                this.props.history.goBack();
              } 
              else {
                this.setState(
                  Object.assign({}, milestone, {
                    id: this.props.match.params.milestoneId,
                    date: date,
                    itemizeState: milestone.items && milestone.items.length > 0,
                    selectedFiatType: milestone.selectedFiatType || "EUR"
                  })
                );
                return(date)
              }
            })
            .then((date) => 
              this.getEthConversion(date)
            )
            .then(() => {
              if(!this.state.hasWhitelist) this.getReviewers()  
            })
            .then(() =>
              this.setState({
                hasError: false,
                isLoading: false
              })
            )
            .catch((e) => console.error(e))             
        } else {
          feathersClient
            .service('campaigns')
            .get(this.props.match.params.id)
            .then(campaign => {
              if (!campaign.projectId) {
                this.props.history.goBack();
              } else {
                this.setState({
                  campaignTitle: campaign.title,
                  campaignProjectId: campaign.projectId,
                  campaignReviewerAddress: campaign.reviewerAddress,
                  campaignOwnerAddress: campaign.ownerAddress,
                });
              }
            })
            .then(() => 
              this.getEthConversion(this.state.date)
            ) 
            .then(() => {
              if(!this.state.hasWhitelist) this.getReviewers()
            })
            .then(() =>
              this.setState({
                hasError: false,
                isLoading: false
              })
            )
            .catch((e) => console.log(e))             
        }
      })     
      .catch(err => {
        console.log('err', err);
        if (err === 'noBalance') this.props.history.goBack();
      });
  }

  getReviewers() {
    return feathersClient
      .service('/users')
      .find({
        query: {
          email: { $exists: true },
          $select: ['_id', 'name', 'address'],
        },
      })
      .then(resp =>
        this.setState({
          reviewers: resp.data.map(r => ({
            value: r.address,
            title: `${r.name ? r.name : 'Anonymous user'} - ${r.address}`,
          }))
        })
      )
  }

  setImage(image) {
    this.setState({ image, uploadNewImage: true });
  }

  setDate(moment) {
    this.setState({ date: moment });
    this.getEthConversion(moment).then((resp) => {
      console.log(resp)
      // update all the input fields
      const rate = resp.rates[this.state.selectedFiatType];
      
      this.setState({ 
        currentRate: resp,
        maxAmount: this.state.fiatAmount.div(rate)
      })
    });
  }

  submit(model) {
    this.setState({ isSaving: true });

    const afterEmit = () => {
      this.setState({ isSaving: false });
      this.props.history.goBack();
    };
    let txHash;

    const updateMilestone = file => {
      // in itemized mode, we calculate the maxAmount from the items

      if(this.state.itemizeState) {
        model.maxAmount = new BigNumber(0);
        this.state.items.forEach((item) => model.maxAmount = model.maxAmount.plus(new BigNumber(item.etherAmount)));
      }

      const constructedModel = {
        title: model.title,
        description: model.description,
        summary: getTruncatedText(this.state.summary, 100),
        maxAmount: utils.toWei(model.maxAmount.toFixed(18)),
        ownerAddress: this.props.currentUser.address,
        reviewerAddress: model.reviewerAddress,
        recipientAddress: model.recipientAddress,
        // completionDeadline: this.state.completionDeadline,
        campaignReviewerAddress: this.state.campaignReviewerAddress,
        image: file,
        campaignId: this.state.campaignId,
        status:
          this.props.isProposed || this.state.status === 'rejected'
            ? 'proposed'
            : this.state.status, // make sure not to change status!
        items: this.state.itemizeState ? this.state.items : [],
        ethConversionRateTimestamp: this.state.currentRate.timestamp,
        selectedFiatType: this.state.selectedFiatType,
        date: this.state.date,
        fiatAmount: this.state.fiatAmount.toFixed(),
        conversionRate: this.state.currentRate.rates[this.state.selectedFiatType]
      };

      if (this.props.isNew) {
        const createMilestone = (txData, callback) => {
          feathersClient
            .service('milestones')
            .create(Object.assign({}, constructedModel, txData))
            .then(() => {
              afterEmit(true);
              callback()
            })
            .catch((err) => {
              console.log(err);
              this.setState({ isSaving: false})
              React.swal({
                title: 'Oh no!',
                content: "Something went wrong, please try again or contact support.",
                icon: 'error',
              });              
            })
        };

        if (this.props.isProposed) {
          createMilestone({
            pluginAddress: '0x0000000000000000000000000000000000000000',
            totalDonated: '0',
            donationCount: 0,
            campaignOwnerAddress: this.state.campaignOwnerAddress,
          }, () =>
            React.toast.info(
              <p>Your Milestone is being proposed to the Campaign Owner.</p>,
            )
          )
        } else {
          let etherScanUrl;
          Promise.all([getNetwork(), getWeb3(), getGasPrice()])
            .then(([network, web3, gasPrice]) => {
              etherScanUrl = network.txHash;

              const from = this.props.currentUser.address;
              const recipient = model.recipientAddress;
              new LPPCappedMilestones(web3, network.cappedMilestoneAddress)
                .addMilestone(
                  model.title,
                  '',
                  constructedModel.maxAmount,
                  this.state.campaignProjectId,
                  recipient,
                  model.reviewerAddress,
                  constructedModel.campaignReviewerAddress,
                  { from, gasPrice },
                )
                .on('transactionHash', hash => {
                  txHash = hash;
                  createMilestone({
                    txHash,
                    pluginAddress: '0x0000000000000000000000000000000000000000',
                    totalDonated: '0',
                    donationCount: '0',
                  }, () =>
                    React.toast.info(
                      <p>
                        Your Milestone is pending....<br />
                        <a
                          href={`${etherScanUrl}tx/${txHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          View transaction
                        </a>
                      </p>,
                    )
                  )
                })
                .then(() => {
                  React.toast.success(
                    <p>
                      Your Milestone has been created!<br />
                      <a
                        href={`${etherScanUrl}tx/${txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        View transaction
                      </a>
                    </p>,
                  );
                });
            })
            .catch(() => {
              displayTransactionError(txHash, etherScanUrl);
            });
        }
      } else {
        feathersClient
          .service('milestones')
          .patch(this.state.id, constructedModel)
          .then(() => {
            React.toast.success(
              <p>
                Your Milestone has been updated!<br />
              </p>
            );

            afterEmit()
          });
      }
    };

    const saveMilestone = () => {

      const uploadMilestoneImage = () => {
        if (this.state.uploadNewImage) {
          feathersClient
            .service('/uploads')
            .create({ uri: this.state.image })
            .then(file => updateMilestone(file.url));
        } else {
          updateMilestone();
        }      
      }

      if(this.state.itemizeState) {
        // upload all the item images
        const uploadItemImages = new Promise((resolve, reject) => 
          this.state.items.forEach((item, index) => {
            if(item.image) {
              feathersClient
                .service('/uploads')
                .create({ uri: item.image })
                .then((file) => {
                  item.image = file.url;
                  if(index === 0) resolve('done');
                })
            } else {
              if(index === 0) resolve('done');
            }
          })
        );
        
        uploadItemImages.then(() => uploadMilestoneImage());

      } else {
        uploadMilestoneImage();
      }
    };

    if (this.props.isProposed) {
      React.swal({
        title: 'Propose milestone?',
        text:
          'The milestone will be proposed to the campaign owner and he or she might approve or reject your milestone.',
        icon: 'warning',
        dangerMode: true,
        buttons: ['Cancel', 'Yes, propose'],
      }).then(isConfirmed => {
        if (isConfirmed) saveMilestone();
      });
    } else if (this.props.isNew) {
      // Save the Milestone
      confirmBlockchainTransaction(() => saveMilestone(), () => this.setState({ isSaving: false }));
    } else {
      saveMilestone();
    }
  }

  toggleFormValid(state) {
    if(this.state.itemizeState) {
      this.setState({ formIsValid: state && this.state.items.length > 0 });
    } else {
      this.setState({ formIsValid: state });
    }
  }

  constructSummary(text) {
    this.setState({ summary: text });
  }

  btnText() {
    if (this.props.isNew) {
      return this.props.isProposed ? 'Propose Milestone' : 'Create Milestone';
    }

    return 'Update Milestone';
  }

  addItem(item) {
    this.setState({ items: this.state.items.concat(item)});
  }

  removeItem(index) {
    let items = this.state.items;
    delete items[index];
    this.setState({ items: items.filter(x => true) });
  }

  mapInputs(inputs) {
    return {
      title: inputs.title,
      description: inputs.description,
      reviewerAddress: inputs.reviewerAddress,
      recipientAddress: inputs.recipientAddress,
      items: this.state.items,
      maxAmount: inputs.maxAmount
    }
  }

  toggleItemize () {
    this.setState({ itemizeState: !this.state.itemizeState })
  }

  getEthConversion (date) {
    console.log('getting rate for date', moment(date).toDate())
    // generate utc timestamp, set at start of day
    const utcDate = moment(date).toDate().setUTCHours(0,0,0,0);
    const timestamp = Math.round(utcDate) / 1000; 

    const conversionRates = this.state.conversionRates;
    const cachedConversionRate = conversionRates.find((c) => c.timestamp === timestamp);

    if(!cachedConversionRate) {
      // we don't have the conversion rate in cache, fetch from feathers
      return feathersClient
        .service('ethconversion')
        .find({query: { date: date }})
        .then(resp => {
          
          this.setState({ 
            conversionRates: conversionRates.concat(resp),
            maxAmount: this.state.fiatAmount / resp.rates[this.state.selectedFiatType],
            currentRate: resp 
          })            

          return resp;
        }) 
        .catch((e) => console.error(e))  
    } else {  
      // we have the conversion rate in cache
      return new Promise((resolve, reject) => {
        this.setState(
          { currentRate: cachedConversionRate }, 
          () => resolve(cachedConversionRate)
        );
      });
    }
  }

  setMaxAmount(e) {
    if(this.refs.fiatAmount.getValue()){
      const fiatAmount = new BigNumber(this.refs.fiatAmount.getValue())
      const conversionRate = this.state.currentRate.rates[this.state.selectedFiatType];
      if(conversionRate && fiatAmount.gte(0)) {
        this.setState({ 
          maxAmount: fiatAmount.div(conversionRate),
          fiatAmount: fiatAmount
        })
      }
    }
  }

  setFiatAmount(e) {
    if(this.refs.maxAmount.getValue()){
      const maxAmount = new BigNumber(this.refs.maxAmount.getValue())
      const conversionRate = this.state.currentRate.rates[this.state.selectedFiatType];

      if(conversionRate && maxAmount.gte(0)) {
        this.setState({ 
          fiatAmount: maxAmount.times(conversionRate),
          maxAmount: maxAmount.toNumber()
        })
      }
    }
  } 

  changeSelectedFiat(fiatType) {
    const conversionRate = this.state.currentRate.rates[fiatType];
    this.setState({ 
      maxAmount: this.state.fiatAmount.div(conversionRate),
      selectedFiatType: fiatType
    })    
  }  

  render() {
    const { isNew, isProposed, history } = this.props;
    const {
      isLoading,
      isSaving,
      title,
      description,
      image,
      recipientAddress,
      reviewerAddress,
      formIsValid,
      maxAmount,
      campaignTitle,
      hasWhitelist,
      whitelistReviewerOptions,
      projectId,
      items,
      itemizeState,
      fiatAmount,
      date,
      selectedFiatType,
      fiatTypes,
      currentRate,
      reviewers,
    } = this.state;

    return (
      <div id="edit-milestone-view">
        <div className="container-fluid page-layout edit-view">
          <div>
            <div className="col-md-8 m-auto">
              {isLoading && <Loader className="fixed" />}

              {!isLoading && (
                <div>
                  <GoBackButton history={history} />

                  <div className="form-header">
                    {isNew && !isProposed && <h3>Add a new milestone</h3>}

                    {!isNew && !isProposed && <h3>Edit milestone {title}</h3>}

                    {isNew && isProposed && <h3>Propose a Milestone</h3>}

                    <h6>
                      Campaign: <strong>{getTruncatedText(campaignTitle, 100)}</strong>
                    </h6>

                    <p>
                      <i className="fa fa-question-circle" />
                      A Milestone is a single accomplishment within a project. In the end, all
                      donations end up in Milestones. Once your Milestone is completed, you can
                      request a payout.
                    </p>

                    {isProposed && (
                      <p>
                        <i className="fa fa-exclamation-triangle" />
                        You are proposing a Milestone to the Campaign Owner. The Campaign Owner can
                        accept or reject your Milestone
                      </p>
                    )}
                  </div>

                  <Form
                    onSubmit={this.submit}
                    mapping={inputs => this.mapInputs(inputs)}
                    onValid={() => this.toggleFormValid(true)}
                    onInvalid={() => this.toggleFormValid(false)}
                    layout="vertical"
                  >
                    <Input
                      name="title"
                      label="What are you going to accomplish in this Milestone?"
                      id="title-input"
                      type="text"
                      value={title}
                      placeholder="E.g. buying goods"
                      help="Describe your Milestone in 1 sentence."
                      validations="minLength:3"
                      validationErrors={{
                        minLength: 'Please provide at least 3 characters.',
                      }}
                      required
                      autoFocus
                    />

                    <div className="form-group">
                      <QuillFormsy
                        name="description"
                        label="Explain how you are going to do this successfully."
                        helpText="Make it as extensive as necessary. Your goal is to build trust,
                        so that people donate Ether to your Campaign. Don't hesitate to add a detailed budget for this Milestone"
                        value={description}
                        placeholder="Describe how you're going to execute your Milestone successfully
                        ..."
                        onTextChanged={content => this.constructSummary(content)}
                        validations="minLength:3"
                        help="Describe your Milestone."
                        validationErrors={{
                          minLength: 'Please provide at least 3 characters.',
                        }}
                        required
                      />
                    </div>

                    <div className="form-group">
                      <FormsyImageUploader
                        setImage={this.setImage}
                        previewImage={image}
                        required={isNew}
                      />
                    </div>

                    <div className="form-group">
                      {hasWhitelist && (
                        <SelectFormsy
                          name="reviewerAddress"
                          id="reviewer-select"
                          label="Select a reviewer"
                          helpText="Each milestone needs a reviewer who verifies that the milestone is
                          completed successfully"
                          value={reviewerAddress}
                          cta="--- Select a reviewer ---"
                          options={whitelistReviewerOptions}
                          validations="isEtherAddress"
                          validationErrors={{
                            isEtherAddress: 'Please select a reviewer.',
                          }}
                          required
                          disabled={!isNew && !isProposed}
                        />
                      )}

                      {!hasWhitelist && (
                        <SelectFormsy
                          name="reviewerAddress"
                          id="reviewer-select"
                          label="Select a reviewer"
                          helpText="Each milestone needs a reviewer who verifies that the milestone is
                          completed successfully"
                          value={reviewerAddress}
                          cta="--- Select a reviewer ---"
                          options={reviewers}
                          validations="isEtherAddress"
                          validationErrors={{
                            isEtherAddress: 'Please select a reviewer.',
                          }}
                          required
                          disabled={!isNew && !isProposed}
                        />
                      )}
                    </div>

                    <div className="form-group">
                      <Input
                        name="recipientAddress"
                        id="title-input"
                        label="Where will the money go after completion?"
                        type="text"
                        value={recipientAddress}
                        placeholder="0x0000000000000000000000000000000000000000"
                        help="Enter an Ethereum address."
                        validations="isEtherAddress"
                        validationErrors={{
                          isEtherAddress: 'Please insert a valid Ethereum address.',
                        }}
                        required
                        disabled={projectId}
                      />
                    </div>

                    <div className="react-toggle-container">
                      <Toggle
                        id='itemize-state'
                        defaultChecked={this.state.itemizeState}
                        onChange={()=>this.toggleItemize()} 
                        disabled={!isNew && !isProposed}
                      />
                      <label htmlFor='itemize-state'>Add multiple expenses, invoices or items</label>
                    </div>

                    { !itemizeState &&
                      <div className="card milestone-items-card">
                        <div className="card-body">
                          <div className="form-group row">
                            <div className="col-12">
                              <DatePickerFormsy
                                name="date"
                                type="text"
                                value={date}
                                startDate={date}
                                label="Milestone date"
                                changeDate={date => this.setDate(date)}
                                placeholder="Select a date"
                                help="Select a date"
                                validations="minLength:8"
                                validationErrors={{
                                  minLength: 'Please provide a date.',
                                }}
                                required
                                disabled={projectId}                              
                              />
                            </div>
                          </div>

                          <div className="form-group row">
                            <div className="col-4">
                              <Input
                                name="fiatAmount"
                                id="fiatamount-input"
                                type="number"
                                ref="fiatAmount"
                                label="Maximum amount in fiat"
                                value={fiatAmount}
                                placeholder="10"
                                validations="greaterThan:1"
                                validationErrors={{
                                  greaterThan: 'Minimum value must be at least 1',
                                }}
                                disabled={projectId}
                                onKeyUp={this.setMaxAmount}                
                              />
                            </div>

                            <div className="col-4">
                              <SelectFormsy
                                name="fiatType"
                                label="Currency"
                                value={selectedFiatType}
                                options={fiatTypes}
                                onChange={this.changeSelectedFiat}
                                helpText={`1 Eth = ${currentRate.rates[selectedFiatType]} ${selectedFiatType}`}
                                disabled={projectId}                                                            
                                required
                              /> 
                            </div>                          

                            <div className="col-4">
                              <Input
                                name="maxAmount"
                                id="maxamount-input"
                                type="number"
                                ref="maxAmount"
                                label="Maximum amount in &#926;"
                                value={maxAmount}
                                placeholder="10"
                                validations="greaterThan:0.0099999999999"
                                validationErrors={{
                                  greaterThan: 'Minimum value must be at least Ξ 0.1',
                                }}
                                required
                                disabled={projectId}
                                onKeyUp={this.setFiatAmount}                
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    }

                    { itemizeState && 
                      <div className="form-group row dashboard-table-view">
                        <div className="col-12">
                          <div className="card milestone-items-card">
                            <div className="card-body">                        
                              { items.length > 0 && 
                                <div className="table-container">
                                  <table className="table table-responsive table-striped table-hover">
                                    <thead>
                                      <tr>
                                        <th className="td-item-date">Date</th>                        
                                        <th className="td-item-description">Description</th>
                                        <th className="td-item-amount-fiat">Amount Fiat</th>
                                        <th className="td-item-fiat-amount">Amount Ether</th>
                                        <th className="td-item-file-upload">Attached proof</th>
                                        <th className="td-item-action"></th>                          
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {items.map((item, i) => {
                                        return (
                                          <MilestoneItem 
                                            name={`milestoneItem-${i}`}
                                            key={i}
                                            index={i}
                                            item={item}
                                            removeItem={()=>this.removeItem(i)}
                                            isEditMode={isNew || isProposed}
                                          />
                                        )
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              }

                              { items.length > 0 &&
                                <AddMilestoneItem 
                                  onAddItem={(item)=>this.addItem(item)} 
                                  getEthConversion={(date)=>this.getEthConversion(date)}
                                  fiatTypes={fiatTypes}
                                />
                              }

                              { items.length === 0 &&
                                <div className="text-center">
                                  <p>Add you first item now. This can be an expense, invoice or anything else that needs to be paid.</p>
                                  <AddMilestoneItem 
                                    onAddItem={(item)=>this.addItem(item)} 
                                    getEthConversion={(date)=>this.getEthConversion(date)}
                                    fiatTypes={fiatTypes}
                                  />
                                </div>
                              }                              


                            </div>
                          </div>
                        </div>
                      </div>
                    }

                    <div className="form-group row">
                      <div className="col-6">
                        <GoBackButton history={history} />
                      </div>
                      <div className="col-6">
                        <LoaderButton
                          className="btn btn-success pull-right"
                          formNoValidate
                          type="submit"
                          disabled={isSaving || !formIsValid}
                          isLoading={isSaving}
                          loadingText="Saving..."
                        >
                          <span>{this.btnText()}</span>
                        </LoaderButton>
                      </div>
                    </div>
                  </Form>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }
}

EditMilestone.propTypes = {
  currentUser: PropTypes.instanceOf(User).isRequired,
  history: PropTypes.shape({
    goBack: PropTypes.func.isRequired,
    push: PropTypes.func.isRequired,
  }).isRequired,
  isProposed: PropTypes.bool,
  isNew: PropTypes.bool,
  wallet: PropTypes.instanceOf(GivethWallet).isRequired,
  match: PropTypes.shape({
    params: PropTypes.shape({
      id: PropTypes.string,
      milestoneId: PropTypes.string,
    }).isRequired,
  }).isRequired,
};

EditMilestone.defaultProps = {
  isNew: false,
  isProposed: false,
};

export default EditMilestone;
